import React, { useEffect, useState } from "react";
import { FileCheck2, Send, Trash2, X } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { useAuth } from "../AuthContext.jsx";
import CompanySearchSelect from "../components/CompanySearchSelect.jsx";

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function FacturasPage() {
  const { role } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [pendingCompanyId, setPendingCompanyId] = useState("");
  const [filterCompanyId, setFilterCompanyId] = useState("");
  const [pendingShipments, setPendingShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cutoffDate, setCutoffDate] = useState(todayISO());
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [sequence, setSequence] = useState(null);
  const [editingSeq, setEditingSeq] = useState(false);
  const [editingDraft, setEditingDraft] = useState(null);

  const loadInvoices = () => {
    supabase
      .from("invoices")
      .select("id, series, number, period_start, period_end, total, status, pdf_url, company_id, companies(name)")
      .order("issued_at", { ascending: false })
      .then(({ data }) => {
        setInvoices(data || []);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadInvoices();
    supabase
      .from("companies")
      .select("id, name")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setCompanies(data || []));
  }, []);

  const loadPending = () => {
    if (!pendingCompanyId) {
      setPendingShipments([]);
      return;
    }
    supabase
      .from("shipments")
      .select("shipment_date, service_type, concept, price")
      .eq("company_id", pendingCompanyId)
      .is("invoice_id", null)
      .order("shipment_date")
      .then(({ data }) => setPendingShipments(data || []));
  };

  useEffect(() => {
    loadPending();
    setNotice("");
    if (!pendingCompanyId) {
      setSequence(null);
      return;
    }
    supabase
      .from("invoice_sequences_v2")
      .select("series, next_number")
      .eq("company_id", pendingCompanyId)
      .maybeSingle()
      .then(({ data }) => setSequence(data || { series: "A", next_number: 1 }));
  }, [pendingCompanyId]);

  const pendingTotal = pendingShipments.reduce((sum, s) => sum + Number(s.price), 0);
  const drafts = invoices.filter((inv) => inv.status === "draft" && (!filterCompanyId || inv.company_id === filterCompanyId));
  const issuedInvoices = invoices.filter((inv) => inv.status !== "draft" && (!filterCompanyId || inv.company_id === filterCompanyId));

  const generateNow = async () => {
    setGenerating(true);
    setNotice("");
    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("generate-monthly-invoices", {
      body: { company_id: pendingCompanyId, period_end: cutoffDate },
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    });
    setGenerating(false);

    if (error || data?.error) {
      setNotice("No se pudo generar el borrador: " + (data?.error || error?.message));
      return;
    }
    if (!data?.generated?.length) {
      setNotice("No había envíos pendientes de facturar para esa fecha.");
      return;
    }
    setNotice(`Borrador creado por ${data.generated[0].total} €. Revísalo abajo en "Borradores pendientes" antes de enviarlo.`);
    loadPending();
    loadInvoices();
  };

  const saveSequence = async () => {
    const { error } = await supabase
      .from("invoice_sequences_v2")
      .upsert({ company_id: pendingCompanyId, series: sequence.series, next_number: Number(sequence.next_number) });
    if (error) {
      setNotice("No se pudo guardar la numeración: " + error.message);
      return;
    }
    setEditingSeq(false);
    setNotice("Numeración actualizada.");
  };

  const handleDelete = async (inv) => {
    const sure = window.confirm(
      `Vas a BORRAR la factura ${inv.series}-${inv.number} (${inv.companies?.name}).\n\n` +
      `Sus envíos volverán a quedar pendientes de facturar. Úsalo solo para facturas de PRUEBA — ` +
      `una factura real ya emitida a un cliente no debería borrarse nunca por ley (se rectifica, no se elimina).\n\n¿Continuar?`
    );
    if (!sure) return;
    const { error } = await supabase.rpc("admin_delete_invoice", { target_id: inv.id });
    if (error) {
      alert("No se pudo borrar: " + error.message);
      return;
    }
    loadInvoices();
  };

  const discardDraft = async (inv) => {
    if (!window.confirm(`¿Descartar este borrador de ${inv.companies?.name}? Sus envíos volverán a quedar pendientes de facturar.`)) return;
    const { error } = await supabase.rpc("admin_delete_invoice", { target_id: inv.id });
    if (error) {
      alert("No se pudo descartar: " + error.message);
      return;
    }
    loadInvoices();
  };

  return (
    <div>
      <h1 className="mb-4 text-lg font-black text-[#092640]">Facturas</h1>

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-black text-[#092640]">Acumulado actual sin facturar</h2>
          <CompanySearchSelect companies={companies} value={pendingCompanyId} onChange={setPendingCompanyId} />
        </div>

        {pendingCompanyId ? (
          <>
            <div className="overflow-hidden rounded-xl border border-slate-100">
              <div className="grid grid-cols-[1fr_1fr_1fr_0.8fr] bg-slate-50 px-3 py-2 text-xs font-bold text-slate-400">
                <div>Fecha</div><div>Tipo de envío</div><div>Concepto</div><div>Precio</div>
              </div>
              {pendingShipments.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_0.8fr] border-t border-slate-100 px-3 py-2 text-sm">
                  <div>{s.shipment_date}</div><div>{s.service_type}</div><div className="text-slate-500">{s.concept || "—"}</div><div>{Number(s.price).toFixed(2)} €</div>
                </div>
              ))}
              {pendingShipments.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-slate-400">Sin envíos pendientes de facturar.</div>
              )}
            </div>
            <div className="mt-3 text-right text-sm font-black text-[#092640]">
              Total acumulado: {pendingTotal.toFixed(2)} €
            </div>

            {role === "admin" && sequence && (
              <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
                {editingSeq ? (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">Serie</span>
                    <input
                      value={sequence.series}
                      onChange={(e) => setSequence({ ...sequence, series: e.target.value })}
                      className="w-14 rounded-lg border border-slate-200 px-2 py-1 text-center"
                    />
                    <span className="text-slate-500">Próximo número</span>
                    <input
                      type="number"
                      value={sequence.next_number}
                      onChange={(e) => setSequence({ ...sequence, next_number: e.target.value })}
                      className="w-24 rounded-lg border border-slate-200 px-2 py-1"
                    />
                    <button onClick={saveSequence} className="rounded-lg bg-[#092640] px-3 py-1.5 font-bold text-white">Guardar</button>
                    <button onClick={() => setEditingSeq(false)} className="text-slate-400">Cancelar</button>
                  </div>
                ) : (
                  <>
                    <span className="text-slate-500">
                      Próxima factura de esta empresa será: <strong className="text-[#092640]">{sequence.series}-{String(sequence.next_number).padStart(5, "0")}</strong>
                    </span>
                    <button onClick={() => setEditingSeq(true)} className="text-xs font-bold text-[#092640] underline">Editar numeración</button>
                  </>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
              <label className="text-xs font-bold text-slate-400">Incluir hasta:</label>
              <input
                type="date"
                value={cutoffDate}
                onChange={(e) => setCutoffDate(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                onClick={generateNow}
                disabled={generating || pendingShipments.length === 0}
                className="flex items-center gap-2 rounded-xl bg-[#092640] px-4 py-2 text-sm font-black text-white disabled:opacity-50"
              >
                <FileCheck2 size={16} /> {generating ? "Generando..." : "Generar borrador"}
              </button>
            </div>

            {notice && <p className="mt-3 text-sm font-medium text-green-700">{notice}</p>}
          </>
        ) : (
          <p className="text-sm text-slate-400">Busca una empresa para ver lo que lleva acumulado este periodo, antes de que se facture.</p>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-black text-[#092640]">Borradores pendientes de revisar</h2>
      </div>
      <div className="mb-6 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_0.8fr] bg-amber-100 px-4 py-2 text-xs font-bold text-amber-700">
          <div>Empresa</div>
          <div>Periodo</div>
          <div>Total</div>
          <div></div>
        </div>
        {drafts.map((inv) => (
          <div key={inv.id} className="grid grid-cols-[1.4fr_1fr_1fr_0.8fr] items-center border-t border-amber-100 px-4 py-3 text-sm">
            <div className="font-bold">{inv.companies?.name}</div>
            <div>{inv.period_start} a {inv.period_end}</div>
            <div>{Number(inv.total).toFixed(2)} €</div>
            <div className="flex items-center gap-3">
              <button onClick={() => setEditingDraft(inv)} className="text-xs font-bold text-[#092640] underline">Revisar y enviar</button>
              <button onClick={() => discardDraft(inv)} className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-[#e50914]" title="Descartar borrador">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {drafts.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-amber-700/70">No hay borradores pendientes de revisar.</div>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-black text-[#092640]">Facturas emitidas</h2>
        <CompanySearchSelect companies={companies} value={filterCompanyId} onChange={setFilterCompanyId} placeholder="Buscar por empresa..." />
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.2fr_0.9fr_1fr_0.7fr_0.7fr_0.6fr] bg-slate-50 px-4 py-2 text-xs font-bold text-slate-400">
          <div>Empresa</div>
          <div>Nº factura</div>
          <div>Periodo</div>
          <div>Total</div>
          <div>Estado</div>
          <div></div>
        </div>
        {issuedInvoices.map((inv) => (
          <div key={inv.id} className="grid grid-cols-[1.2fr_0.9fr_1fr_0.7fr_0.7fr_0.6fr] items-center border-t border-slate-100 px-4 py-3 text-sm">
            <div>{inv.companies?.name}</div>
            <div>{inv.series}-{inv.number}</div>
            <div>{inv.period_start} a {inv.period_end}</div>
            <div>{Number(inv.total).toFixed(2)} €</div>
            <div className="capitalize">{inv.status}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => downloadInvoice(inv.pdf_url)} className="text-xs font-bold text-[#092640] underline">PDF</button>
              {role === "admin" && (
                <button onClick={() => handleDelete(inv)} className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-[#e50914]" title="Borrar">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {!loading && issuedInvoices.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            {filterCompanyId ? "Esa empresa no tiene facturas todavía." : "Aún no hay facturas emitidas."}
          </div>
        )}
      </div>

      {editingDraft && (
        <DraftEditorModal
          invoice={editingDraft}
          onClose={() => setEditingDraft(null)}
          onSent={(message) => {
            setEditingDraft(null);
            setNotice(message);
            loadInvoices();
          }}
        />
      )}
    </div>
  );
}

function DraftEditorModal({ invoice, onClose, onSent }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadLines = () => {
    supabase
      .from("invoice_lines")
      .select("id, shipment_id, description, price")
      .eq("invoice_id", invoice.id)
      .then(({ data }) => {
        setLines(data || []);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadLines();
  }, []);

  const subtotal = lines.reduce((sum, l) => sum + Number(l.price || 0), 0);
  const iva = subtotal * 0.21;
  const total = subtotal + iva;

  const updateLine = (id, field, value) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };

  const saveLine = async (line) => {
    await supabase.from("invoice_lines").update({ description: line.description, price: Number(line.price) }).eq("id", line.id);
  };

  const removeLine = async (line) => {
    if (!window.confirm("¿Quitar esta línea del borrador?")) return;
    if (line.shipment_id) {
      await supabase.from("shipments").update({ invoice_id: null }).eq("id", line.shipment_id);
    }
    await supabase.from("invoice_lines").delete().eq("id", line.id);
    loadLines();
  };

  const addManualLine = async () => {
    const { data } = await supabase
      .from("invoice_lines")
      .insert({ invoice_id: invoice.id, shipment_id: null, description: "Nuevo concepto", price: 0 })
      .select()
      .single();
    if (data) setLines((prev) => [...prev, data]);
  };

  const sendInvoice = async () => {
    if (!window.confirm(`Vas a enviar esta factura a ${invoice.companies?.name} por ${total.toFixed(2)} €. A partir de aquí ya no se podrá editar. ¿Confirmas?`)) return;
    setSending(true);
    setError("");

    // Guardamos cualquier cambio pendiente en las líneas antes de enviar
    await Promise.all(lines.map((l) => saveLine(l)));

    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error: fnError } = await supabase.functions.invoke("generate-monthly-invoices", {
      body: { finalize_invoice_id: invoice.id },
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    });

    setSending(false);

    if (fnError || data?.error) {
      setError(data?.error || "No se pudo enviar la factura.");
      return;
    }

    onSent(`Factura ${data.invoice.number} enviada a ${invoice.companies?.name} por ${data.invoice.total} €.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-black text-[#092640]">Borrador · {invoice.companies?.name}</h2>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2"><X size={16} /></button>
        </div>
        <p className="mb-4 text-sm text-slate-500">Periodo: {invoice.period_start} a {invoice.period_end}. Puedes editar, borrar o añadir líneas antes de enviarla.</p>

        {loading ? (
          <p className="text-sm text-slate-400">Cargando...</p>
        ) : (
          <div className="mb-4 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-[1fr_100px_40px] bg-slate-50 px-3 py-2 text-xs font-bold text-slate-400">
              <div>Concepto</div><div>Precio</div><div></div>
            </div>
            {lines.map((line) => (
              <div key={line.id} className="grid grid-cols-[1fr_100px_40px] items-center gap-2 border-t border-slate-100 px-3 py-2">
                <input
                  value={line.description}
                  onChange={(e) => updateLine(line.id, "description", e.target.value)}
                  onBlur={() => saveLine(line)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  value={line.price}
                  onChange={(e) => updateLine(line.id, "price", e.target.value)}
                  onBlur={() => saveLine(line)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
                <button onClick={() => removeLine(line)} className="text-slate-400 hover:text-[#e50914]">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {lines.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-400">Sin líneas. Añade una manualmente si hace falta.</div>}
          </div>
        )}

        <button onClick={addManualLine} className="mb-5 text-xs font-bold text-[#092640] underline">+ Añadir línea manual</button>

        <div className="mb-5 space-y-1 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{subtotal.toFixed(2)} €</span></div>
          <div className="flex justify-between"><span className="text-slate-500">IVA (21%)</span><span>{iva.toFixed(2)} €</span></div>
          <div className="flex justify-between text-base font-black text-[#092640]"><span>Total</span><span>{total.toFixed(2)} €</span></div>
        </div>

        {error && <p className="mb-3 text-sm font-medium text-[#e50914]">{error}</p>}

        <button
          onClick={sendInvoice}
          disabled={sending || lines.length === 0}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#e50914] px-4 py-3 text-sm font-black text-white disabled:opacity-50"
        >
          <Send size={16} /> {sending ? "Enviando..." : "Enviar factura"}
        </button>
      </div>
    </div>
  );
}

async function downloadInvoice(path) {
  const { data, error } = await supabase.storage.from("invoices").createSignedUrl(path, 60);
  if (error || !data) {
    alert("No se pudo generar el enlace de descarga.");
    return;
  }
  window.open(data.signedUrl, "_blank", "noreferrer");
}
