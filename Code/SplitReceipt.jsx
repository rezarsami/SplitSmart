import React, { useState, useRef, useMemo } from "react";

// ============================================================================
// SplitSmart — itemized receipt splitting prototype
// A concept feature for a Venmo-style payments app: scan a receipt, let AI
// parse the line items, assign each item to people, and auto-distribute tax
// and tip proportionally. Prototype only — no real payments.
// ============================================================================

const PEOPLE = [
  { id: "you", name: "You", color: "#3D95CE" },
  { id: "sam", name: "Sam", color: "#E4572E" },
  { id: "priya", name: "Priya", color: "#17A398" },
  { id: "alex", name: "Alex", color: "#A24BCE" },
];

const SAMPLE_ITEMS = [
  { id: 1, name: "Margherita Pizza", price: 18.0 },
  { id: 2, name: "Caesar Salad", price: 12.5 },
  { id: 3, name: "Grilled Salmon", price: 26.0 },
  { id: 4, name: "House Red (2 glasses)", price: 24.0 },
  { id: 5, name: "Tiramisu", price: 9.0 },
];

const money = (n) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

export default function SplitReceipt() {
  const [step, setStep] = useState(1); // 1 scan, 2 review, 3 assign, 4 summary
  const [items, setItems] = useState([]);
  const [tax, setTax] = useState(0);
  const [tip, setTip] = useState(0);
  const [assignments, setAssignments] = useState({}); // itemId -> [personId]
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [payer, setPayer] = useState("you");
  const fileRef = useRef(null);

  // ---- Step 1: scanning -----------------------------------------------------
  async function handleImage(file) {
    setScanError("");
    setScanning(true);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1]);
        r.onerror = () => rej(new Error("Could not read the image"));
        r.readAsDataURL(file);
      });
      const mediaType = file.type || "image/jpeg";

      // Call our own serverless proxy (/api/scan-receipt), NOT Groq directly.
      // The proxy holds the API key server-side; the browser never sees it.
      const response = await fetch("/api/scan-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mediaType }),
      });

      const parsed = await response.json();

      if (!response.ok) {
        throw new Error(
          parsed?.error
            ? "The receipt couldn't be parsed. Try a clearer photo, or enter items manually."
            : "Something went wrong while scanning."
        );
      }

      const parsedItems = (parsed.items || [])
        .filter((it) => it && it.name && typeof it.price === "number")
        .map((it, i) => ({ id: Date.now() + i, name: String(it.name), price: Number(it.price) }));

      if (parsedItems.length === 0) {
        throw new Error("No items were found on that receipt. Try a clearer photo, or enter items manually.");
      }

      setItems(parsedItems);
      setTax(Number(parsed.tax) || 0);
      setTip(Number(parsed.tip) || 0);
      setStep(2);
    } catch (e) {
      setScanError(e.message || "Something went wrong while scanning.");
    } finally {
      setScanning(false);
    }
  }

  function loadSample() {
    setItems(SAMPLE_ITEMS.map((it) => ({ ...it })));
    setTax(7.13);
    setTip(15.0);
    setScanError("");
    setStep(2);
  }

  function startManual() {
    setItems([{ id: Date.now(), name: "", price: 0 }]);
    setTax(0);
    setTip(0);
    setScanError("");
    setStep(2);
  }

  // ---- Step 2: review helpers ----------------------------------------------
  const subtotal = useMemo(() => items.reduce((s, it) => s + (Number(it.price) || 0), 0), [items]);

  function updateItem(id, field, value) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: field === "price" ? value : value } : it))
    );
  }
  function addItem() {
    setItems((prev) => [...prev, { id: Date.now(), name: "", price: 0 }]);
  }
  function removeItem(id) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  // ---- Step 3: assignment ---------------------------------------------------
  function toggleAssign(itemId, personId) {
    setAssignments((prev) => {
      const current = prev[itemId] || [];
      const next = current.includes(personId)
        ? current.filter((p) => p !== personId)
        : [...current, personId];
      return { ...prev, [itemId]: next };
    });
  }

  const allAssigned = items.length > 0 && items.every((it) => (assignments[it.id] || []).length > 0);

  // ---- Step 4: compute per-person totals ------------------------------------
  const perPerson = useMemo(() => {
    const totals = {};
    PEOPLE.forEach((p) => (totals[p.id] = { items: 0, tax: 0, tip: 0 }));
    items.forEach((it) => {
      const who = assignments[it.id] || [];
      if (who.length === 0) return;
      const share = (Number(it.price) || 0) / who.length;
      who.forEach((pid) => (totals[pid].items += share));
    });
    const assignedSubtotal = Object.values(totals).reduce((s, t) => s + t.items, 0);
    PEOPLE.forEach((p) => {
      const frac = assignedSubtotal > 0 ? totals[p.id].items / assignedSubtotal : 0;
      totals[p.id].tax = frac * tax;
      totals[p.id].tip = frac * tip;
      totals[p.id].total = totals[p.id].items + totals[p.id].tax + totals[p.id].tip;
    });
    return totals;
  }, [items, assignments, tax, tip]);

  const grandTotal = subtotal + tax + tip;

  // ---- shared styles --------------------------------------------------------
  const S = styles;

  return (
    <div style={S.frame}>
      <div style={S.phone}>
        <Header step={step} onBack={step > 1 ? () => setStep(step - 1) : null} />

        <div style={S.body}>
          {step === 1 && (
            <ScanStep
              scanning={scanning}
              scanError={scanError}
              fileRef={fileRef}
              onPick={() => fileRef.current?.click()}
              onFile={handleImage}
              onSample={loadSample}
              onManual={startManual}
            />
          )}

          {step === 2 && (
            <ReviewStep
              items={items}
              tax={tax}
              tip={tip}
              subtotal={subtotal}
              onUpdate={updateItem}
              onAdd={addItem}
              onRemove={removeItem}
              onTax={setTax}
              onTip={setTip}
              onNext={() => setStep(3)}
            />
          )}

          {step === 3 && (
            <AssignStep
              items={items}
              assignments={assignments}
              onToggle={toggleAssign}
              allAssigned={allAssigned}
              onNext={() => setStep(4)}
            />
          )}

          {step === 4 && (
            <SummaryStep
              perPerson={perPerson}
              payer={payer}
              onPayer={setPayer}
              subtotal={subtotal}
              tax={tax}
              tip={tip}
              grandTotal={grandTotal}
              onRestart={() => {
                setStep(1);
                setItems([]);
                setAssignments({});
                setTax(0);
                setTip(0);
                setScanError("");
              }}
            />
          )}
        </div>
      </div>
      <p style={S.disclaimer}>
        Prototype concept — not affiliated with Venmo. No real payments are sent. Receipt scanning uses AI vision;
        a review step lets you correct any misreads before splitting.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header({ step, onBack }) {
  const labels = ["Scan", "Review", "Assign", "Split"];
  return (
    <div style={styles.header}>
      <div style={styles.headerTop}>
        {onBack ? (
          <button onClick={onBack} style={styles.backBtn} aria-label="Go back">
            ‹
          </button>
        ) : (
          <span style={{ width: 24 }} />
        )}
        <span style={styles.brand}>
          Split<span style={{ fontWeight: 800 }}>Smart</span>
        </span>
        <span style={{ width: 24 }} />
      </div>
      <div style={styles.stepper}>
        {labels.map((l, i) => {
          const n = i + 1;
          const active = n === step;
          const done = n < step;
          return (
            <div key={l} style={styles.stepItem}>
              <div
                style={{
                  ...styles.stepDot,
                  background: active ? "#fff" : done ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.25)",
                  color: active || done ? "#0A6EBD" : "rgba(255,255,255,0.7)",
                }}
              >
                {done ? "✓" : n}
              </div>
              <span style={{ ...styles.stepLabel, opacity: active ? 1 : 0.7 }}>{l}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScanStep({ scanning, scanError, fileRef, onPick, onFile, onSample, onManual }) {
  return (
    <div style={styles.stepPad}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />

      <div style={styles.scanCard} onClick={scanning ? undefined : onPick} role="button" tabIndex={0}>
        {scanning ? (
          <>
            <div style={styles.spinner} />
            <p style={styles.scanTitle}>Reading your receipt…</p>
            <p style={styles.scanSub}>Extracting items, tax, and tip</p>
          </>
        ) : (
          <>
            <div style={styles.scanIcon}>⛶</div>
            <p style={styles.scanTitle}>Scan a receipt</p>
            <p style={styles.scanSub}>Take a photo or upload an image — AI pulls out the line items</p>
          </>
        )}
      </div>

      {scanError && <div style={styles.errorBox}>{scanError}</div>}

      <div style={styles.orRow}>
        <span style={styles.orLine} />
        <span style={styles.orText}>or</span>
        <span style={styles.orLine} />
      </div>

      <button style={styles.ghostBtn} onClick={onSample} disabled={scanning}>
        Try a sample receipt
      </button>
      <button style={styles.textBtn} onClick={onManual} disabled={scanning}>
        Enter items manually
      </button>
    </div>
  );
}

function ReviewStep({ items, tax, tip, subtotal, onUpdate, onAdd, onRemove, onTax, onTip, onNext }) {
  return (
    <div style={styles.stepPad}>
      <p style={styles.stepHeading}>Check the items</p>
      <p style={styles.stepCaption}>
        The scanner filled these in. Fix anything that looks off before you split.
      </p>

      <div style={styles.itemList}>
        {items.map((it) => (
          <div key={it.id} style={styles.itemRow}>
            <input
              style={styles.itemName}
              value={it.name}
              placeholder="Item name"
              onChange={(e) => onUpdate(it.id, "name", e.target.value)}
            />
            <div style={styles.priceWrap}>
              <span style={styles.dollar}>$</span>
              <input
                style={styles.itemPrice}
                type="number"
                step="0.01"
                value={it.price === 0 ? "" : it.price}
                placeholder="0.00"
                onChange={(e) => onUpdate(it.id, "price", parseFloat(e.target.value) || 0)}
              />
            </div>
            <button style={styles.removeBtn} onClick={() => onRemove(it.id)} aria-label="Remove item">
              ×
            </button>
          </div>
        ))}
      </div>

      <button style={styles.addBtn} onClick={onAdd}>
        + Add item
      </button>

      <div style={styles.totalsBox}>
        <TotalLine label="Subtotal" value={money(subtotal)} muted />
        <div style={styles.editTotalRow}>
          <span style={styles.editTotalLabel}>Tax</span>
          <div style={styles.priceWrapSm}>
            <span style={styles.dollar}>$</span>
            <input
              style={styles.smallNum}
              type="number"
              step="0.01"
              value={tax === 0 ? "" : tax}
              placeholder="0.00"
              onChange={(e) => onTax(parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
        <div style={styles.editTotalRow}>
          <span style={styles.editTotalLabel}>Tip</span>
          <div style={styles.priceWrapSm}>
            <span style={styles.dollar}>$</span>
            <input
              style={styles.smallNum}
              type="number"
              step="0.01"
              value={tip === 0 ? "" : tip}
              placeholder="0.00"
              onChange={(e) => onTip(parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
        <div style={styles.divider} />
        <TotalLine label="Total" value={money(subtotal + tax + tip)} bold />
      </div>

      <button
        style={{ ...styles.primaryBtn, ...(items.length === 0 ? styles.btnDisabled : {}) }}
        onClick={onNext}
        disabled={items.length === 0}
      >
        Assign items →
      </button>
    </div>
  );
}

function AssignStep({ items, assignments, onToggle, allAssigned, onNext }) {
  return (
    <div style={styles.stepPad}>
      <p style={styles.stepHeading}>Who had what?</p>
      <p style={styles.stepCaption}>
        Tap the people who shared each item. Split anything — tax and tip follow automatically.
      </p>

      <div style={styles.assignList}>
        {items.map((it) => {
          const who = assignments[it.id] || [];
          return (
            <div key={it.id} style={styles.assignCard}>
              <div style={styles.assignHead}>
                <span style={styles.assignName}>{it.name || "Untitled item"}</span>
                <span style={styles.assignPrice}>{money(it.price)}</span>
              </div>
              <div style={styles.chipRow}>
                {PEOPLE.map((p) => {
                  const on = who.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => onToggle(it.id, p.id)}
                      style={{
                        ...styles.chip,
                        background: on ? p.color : "transparent",
                        color: on ? "#fff" : "#5B6470",
                        borderColor: on ? p.color : "#D5DBE2",
                      }}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
              {who.length > 1 && (
                <p style={styles.splitNote}>
                  Split {who.length} ways · {money(it.price / who.length)} each
                </p>
              )}
            </div>
          );
        })}
      </div>

      <button
        style={{ ...styles.primaryBtn, ...(allAssigned ? {} : styles.btnDisabled) }}
        onClick={onNext}
        disabled={!allAssigned}
      >
        {allAssigned ? "See the split →" : "Assign every item to continue"}
      </button>
    </div>
  );
}

function SummaryStep({ perPerson, payer, onPayer, subtotal, tax, tip, grandTotal, onRestart }) {
  const owing = PEOPLE.filter((p) => p.id !== payer && perPerson[p.id].total > 0.005);
  return (
    <div style={styles.stepPad}>
      <p style={styles.stepHeading}>The split</p>

      <div style={styles.payerRow}>
        <span style={styles.payerLabel}>Paid by</span>
        <select style={styles.payerSelect} value={payer} onChange={(e) => onPayer(e.target.value)}>
          {PEOPLE.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div style={styles.summaryList}>
        {PEOPLE.map((p) => {
          const t = perPerson[p.id];
          if (t.total < 0.005) return null;
          const isPayer = p.id === payer;
          return (
            <div key={p.id} style={styles.summaryCard}>
              <div style={styles.summaryTop}>
                <span style={styles.avatar(p.color)}>{p.name[0]}</span>
                <div style={{ flex: 1 }}>
                  <div style={styles.summaryName}>
                    {p.name} {isPayer && <span style={styles.payerTag}>paid</span>}
                  </div>
                  <div style={styles.summaryBreak}>
                    {money(t.items)} items · {money(t.tax)} tax · {money(t.tip)} tip
                  </div>
                </div>
                <span style={styles.summaryTotal}>{money(t.total)}</span>
              </div>
              {!isPayer && (
                <button style={{ ...styles.requestBtn, background: p.color }}>
                  Request {money(t.total)} from {p.name}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div style={styles.totalsBox}>
        <TotalLine label="Subtotal" value={money(subtotal)} muted />
        <TotalLine label="Tax" value={money(tax)} muted />
        <TotalLine label="Tip" value={money(tip)} muted />
        <div style={styles.divider} />
        <TotalLine label="Total" value={money(grandTotal)} bold />
      </div>

      {owing.length > 0 && (
        <button style={styles.primaryBtn}>
          Send {owing.length} request{owing.length > 1 ? "s" : ""} · {money(grandTotal - perPerson[payer].total)}
        </button>
      )}
      <button style={styles.textBtn} onClick={onRestart}>
        Start over
      </button>
    </div>
  );
}

function TotalLine({ label, value, muted, bold }) {
  return (
    <div style={styles.totalLine}>
      <span style={{ color: muted ? "#8A929E" : "#1C2530", fontWeight: bold ? 700 : 500 }}>{label}</span>
      <span style={{ color: muted ? "#8A929E" : "#1C2530", fontWeight: bold ? 700 : 600 }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const BLUE = "#0A6EBD";
const BLUE_DK = "#0A6EBD";

const styles = {
  frame: {
    minHeight: "100%",
    background: "#EEF1F5",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "24px 12px",
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  phone: {
    width: "100%",
    maxWidth: 400,
    background: "#fff",
    borderRadius: 28,
    overflow: "hidden",
    boxShadow: "0 20px 50px rgba(16,42,67,0.18)",
    border: "1px solid #E3E8EE",
  },
  header: {
    background: `linear-gradient(135deg, ${BLUE} 0%, #17A0D8 100%)`,
    padding: "18px 20px 20px",
    color: "#fff",
  },
  headerTop: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
  brand: { fontSize: 20, fontWeight: 500, letterSpacing: -0.3 },
  backBtn: {
    background: "rgba(255,255,255,0.18)",
    border: "none",
    color: "#fff",
    width: 24,
    height: 24,
    borderRadius: 12,
    fontSize: 18,
    lineHeight: "22px",
    cursor: "pointer",
    padding: 0,
  },
  stepper: { display: "flex", justifyContent: "space-between", gap: 4 },
  stepItem: { display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flex: 1 },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    transition: "all 0.2s",
  },
  stepLabel: { fontSize: 11, fontWeight: 500 },
  body: { background: "#fff" },
  stepPad: { padding: "22px 20px 26px" },

  scanCard: {
    border: "2px dashed #C3D0DD",
    borderRadius: 18,
    padding: "40px 20px",
    textAlign: "center",
    cursor: "pointer",
    background: "#F7FAFC",
    transition: "all 0.2s",
  },
  scanIcon: { fontSize: 40, color: BLUE, marginBottom: 8, lineHeight: 1 },
  scanTitle: { fontSize: 17, fontWeight: 600, color: "#1C2530", margin: "6px 0 4px" },
  scanSub: { fontSize: 13, color: "#8A929E", margin: 0, lineHeight: 1.5, maxWidth: 240, marginInline: "auto" },
  spinner: {
    width: 36,
    height: 36,
    border: "3px solid #DCE6F0",
    borderTopColor: BLUE,
    borderRadius: "50%",
    margin: "0 auto 12px",
    animation: "spin 0.8s linear infinite",
  },
  errorBox: {
    marginTop: 14,
    padding: "12px 14px",
    background: "#FDECEC",
    border: "1px solid #F5C2C2",
    borderRadius: 12,
    color: "#B23B3B",
    fontSize: 13,
    lineHeight: 1.45,
  },
  orRow: { display: "flex", alignItems: "center", gap: 12, margin: "22px 0 16px" },
  orLine: { flex: 1, height: 1, background: "#E3E8EE" },
  orText: { fontSize: 12, color: "#A6AEB8", fontWeight: 500 },
  ghostBtn: {
    width: "100%",
    padding: "13px",
    background: "#fff",
    border: `1.5px solid ${BLUE}`,
    color: BLUE,
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: 10,
  },
  textBtn: {
    width: "100%",
    padding: "11px",
    background: "transparent",
    border: "none",
    color: "#8A929E",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },

  stepHeading: { fontSize: 19, fontWeight: 700, color: "#1C2530", margin: "0 0 4px" },
  stepCaption: { fontSize: 13.5, color: "#8A929E", margin: "0 0 18px", lineHeight: 1.5 },

  itemList: { display: "flex", flexDirection: "column", gap: 8 },
  itemRow: { display: "flex", alignItems: "center", gap: 8 },
  itemName: {
    flex: 1,
    padding: "11px 12px",
    border: "1px solid #E3E8EE",
    borderRadius: 10,
    fontSize: 14,
    color: "#1C2530",
    outline: "none",
    fontFamily: "inherit",
  },
  priceWrap: {
    display: "flex",
    alignItems: "center",
    border: "1px solid #E3E8EE",
    borderRadius: 10,
    padding: "0 10px",
    width: 92,
  },
  priceWrapSm: {
    display: "flex",
    alignItems: "center",
    border: "1px solid #E3E8EE",
    borderRadius: 10,
    padding: "0 10px",
    width: 92,
    background: "#fff",
  },
  dollar: { color: "#8A929E", fontSize: 14, fontWeight: 500 },
  itemPrice: {
    width: "100%",
    padding: "11px 4px",
    border: "none",
    fontSize: 14,
    color: "#1C2530",
    outline: "none",
    textAlign: "right",
    fontFamily: "inherit",
  },
  removeBtn: {
    background: "#F3F5F8",
    border: "none",
    color: "#A6AEB8",
    width: 28,
    height: 28,
    borderRadius: 8,
    fontSize: 18,
    cursor: "pointer",
    flexShrink: 0,
    lineHeight: 1,
  },
  addBtn: {
    marginTop: 10,
    padding: "9px 14px",
    background: "#EDF5FB",
    border: "none",
    color: BLUE,
    borderRadius: 10,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
  },

  totalsBox: { marginTop: 20, padding: "14px 16px", background: "#F7FAFC", borderRadius: 14 },
  totalLine: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontSize: 14 },
  editTotalRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "4px 0",
  },
  editTotalLabel: { fontSize: 14, color: "#5B6470", fontWeight: 500 },
  smallNum: {
    width: "100%",
    padding: "8px 4px",
    border: "none",
    fontSize: 14,
    color: "#1C2530",
    outline: "none",
    textAlign: "right",
    background: "transparent",
    fontFamily: "inherit",
  },
  divider: { height: 1, background: "#E3E8EE", margin: "8px 0" },

  assignList: { display: "flex", flexDirection: "column", gap: 12 },
  assignCard: { padding: "14px", border: "1px solid #E9EEF3", borderRadius: 14, background: "#fff" },
  assignHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11 },
  assignName: { fontSize: 15, fontWeight: 600, color: "#1C2530" },
  assignPrice: { fontSize: 15, fontWeight: 600, color: "#1C2530" },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 7 },
  chip: {
    padding: "7px 14px",
    borderRadius: 20,
    border: "1.5px solid #D5DBE2",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: "inherit",
  },
  splitNote: { fontSize: 12, color: "#8A929E", margin: "10px 0 0", fontWeight: 500 },

  payerRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16 },
  payerLabel: { fontSize: 14, color: "#5B6470", fontWeight: 500 },
  payerSelect: {
    flex: 1,
    padding: "9px 12px",
    border: "1px solid #E3E8EE",
    borderRadius: 10,
    fontSize: 14,
    color: "#1C2530",
    background: "#fff",
    fontFamily: "inherit",
    fontWeight: 600,
  },
  summaryList: { display: "flex", flexDirection: "column", gap: 11, marginBottom: 8 },
  summaryCard: { padding: "14px", border: "1px solid #E9EEF3", borderRadius: 14 },
  summaryTop: { display: "flex", alignItems: "center", gap: 12 },
  avatar: (color) => ({
    width: 38,
    height: 38,
    borderRadius: 19,
    background: color,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    fontWeight: 700,
    flexShrink: 0,
  }),
  summaryName: { fontSize: 15, fontWeight: 600, color: "#1C2530" },
  payerTag: {
    fontSize: 11,
    fontWeight: 600,
    color: "#17A398",
    background: "#E4F5F2",
    padding: "2px 7px",
    borderRadius: 6,
    marginLeft: 6,
  },
  summaryBreak: { fontSize: 12, color: "#8A929E", marginTop: 2 },
  summaryTotal: { fontSize: 17, fontWeight: 700, color: "#1C2530" },
  requestBtn: {
    width: "100%",
    marginTop: 12,
    padding: "10px",
    border: "none",
    color: "#fff",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },

  primaryBtn: {
    width: "100%",
    marginTop: 22,
    padding: "15px",
    background: BLUE,
    border: "none",
    color: "#fff",
    borderRadius: 14,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  btnDisabled: { background: "#C3D0DD", cursor: "not-allowed" },
  disclaimer: {
    maxWidth: 400,
    fontSize: 11.5,
    color: "#98A0AB",
    textAlign: "center",
    marginTop: 16,
    lineHeight: 1.5,
    padding: "0 8px",
  },
};

// keyframes injected once
if (typeof document !== "undefined" && !document.getElementById("splitsmart-kf")) {
  const st = document.createElement("style");
  st.id = "splitsmart-kf";
  st.textContent = "@keyframes spin{to{transform:rotate(360deg)}}";
  document.head.appendChild(st);
}
