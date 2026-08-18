import React, { useEffect, useState } from "react";
import { Pencil, Plus, Power, Search, Trash2, X } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { useAuth } from "../AuthContext.jsx";

export default function EmpresasPage() {
  const { profile, role } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalCompany, setModalCompany] = useState(null); // null = cerrado, {} = crear, {...} = editar
  const [detailCompany, setDetailCompany] = useState(null);
  const [notice, setNotice] = useState("");

  const loadCompanies = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("companies")
      .select("id, name, nif_cif, email, fiscal_address, phone, portal_user_id, active")
      .order("name");
    setCompanies(data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const filtered = companies.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  const toggleActive = async (company) => {
    const confirmMsg = company.active
      ? `¿Desactivar "${company.name}"? Dejará de aparecer para nuevos envíos, pero su historial y facturas se conservan.`
      : `¿Reactivar "${company.name}"?`;
    if (!window.confirm(confirmMsg)) return;
    await supabase.from("companies").update({ active: !company.active }).eq("id", company.id);
    loadCompanies();
  };

  const deleteCompany = async (company) => {
    const sure = window.confirm(
      `Vas a BORRAR PERMANENTEMENTE "${company.name}" y todos sus envíos y facturas asociadas.\n\nEsto no se puede deshacer. Úsalo solo para limpiar empresas de prueba, nunca para clientes reales facturados (para eso, usa "Desactivar").\n\n¿Continuar?`
    );
    if (!sure) return;
    const { error } = await supabase.rpc("admin_delete_company", { target_id: company.id });
    if (error) {
      alert("No se pudo borrar: " + error.message);
      return;
    }
    setNotice(`"${company.name}" se borró permanentemente.`);
    loadCompanies();
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-black text-[#092640]">Empresas</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa..."
              className="rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <span className="text-sm text-slate-500">{loading ? "Cargando..." : `${filtered.length} empresas`}</span>
          <button
            onClick={() => setModalCompany({})}
            className="flex items-center gap-2 rounded-xl bg-[#092640] px-4 py-2 text-sm font-black text-white"
          >
            <Plus size={16} /> Nueva empresa
          </button>
        </div>
      </div>

      {notice && <p className="mb-3 text-sm font-medium text-green-700">{notice}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.6fr_1fr_0.8fr_0.9fr] bg-slate-50 px-4 py-2 text-xs font-bold text-slate-400">
          <div>Empresa</div>
          <div>NIF/CIF</div>
          <div>Portal</div>
          <div>Acciones</div>
        </div>
        {filtered.map((c) => (
          <div key={c.id} className={`grid grid-cols-[1.6fr_1fr_0.8fr_0.9fr] items-center border-t border-slate-100 px-4 py-3 text-sm ${!c.active ? "opacity-50" : ""}`}>
            <button onClick={() => setDetailCompany(c)} className="text-left font-bold text-[#092640] underline decoration-transparent hover:decoration-inherit">
              {c.name}
            </button>
            <div>{c.nif_cif}</div>
            <div>
              {!c.active ? (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600">Desactivada</span>
              ) : (
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${c.portal_user_id ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                  {c.portal_user_id ? "Activo" : "Pendiente"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setModalCompany(c)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Editar">
                <Pencil size={15} />
              </button>
              <button onClick={() => toggleActive(c)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title={c.active ? "Desactivar" : "Reactivar"}>
                <Power size={15} />
              </button>
              {role === "admin" && (
                <button onClick={() => deleteCompany(c)} className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-[#e50914]" title="Borrar permanentemente">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            {search ? "Ninguna empresa coincide con la búsqueda." : "Aún no hay empresas. Crea la primera con el botón de arriba."}
          </div>
        )}
      </div>

      {modalCompany !== null && (
        <CompanyModal
          company={modalCompany}
          profileId={profile.id}
          onClose={() => setModalCompany(null)}
          onSaved={(message) => {
            setModalCompany(null);
            setNotice(message);
            loadCompanies();
          }}
        />
      )}

      {detailCompany && (
        <CompanyDetailModal company={detailCompany} onClose={() => setDetailCompany(null)} />
      )}
    </div>
  );
}

function CompanyDetailModal({ company, onClose }) {
  const [rates, setRates] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [pending, setPending] = useState([]);

  useEffect(() => {
    supabase.from("company_rates").select("service_type, price").eq("company_id", company.id)
      .then(({ data }) => setRates(data || []));
    supabase.from("invoices").select("id, series, number, period_start, period_end, total, status")
      .eq("company_id", company.id).order("issued_at", { ascending: false })
      .then(({ data }) => setInvoices(data || []));
    supabase.from("shipments").select("price").eq("company_id", company.id).is("invoice_id", null)
      .then(({ data }) => setPending(data || []));
  }, [company.id]);

  const pendingTotal = pending.reduce((sum, s) => sum + Number(s.price), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-[#092640]">{company.name}</h2>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2"><X size={16} /></button>
        </div>

        <div className="mb-5 flex items-center justify-between rounded-xl bg-[#092640] px-4 py-3 text-white">
          <span className="text-sm font-bold">Acumulado sin facturar ({pending.length} envíos)</span>
          <span className="text-lg font-black">{pendingTotal.toFixed(2)} €</span>
        </div>

        <h3 className="mb-2 text-xs font-bold uppercase text-slate-400">Tarifa actual</h3>
        <div className="mb-5 overflow-hidden rounded-xl border border-slate-100">
          {rates.map((r) => (
            <div key={r.service_type} className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-sm first:border-t-0">
              <span>{r.service_type}</span>
              <span className="font-bold">{Number(r.price).toFixed(2)} €</span>
            </div>
          ))}
          {rates.length === 0 && <div className="px-3 py-4 text-center text-sm text-slate-400">Sin tarifa asignada.</div>}
        </div>

        <h3 className="mb-2 text-xs font-bold uppercase text-slate-400">Historial de facturas</h3>
        <div className="overflow-hidden rounded-xl border border-slate-100">
          <div className="grid grid-cols-[1fr_1fr_0.7fr] bg-slate-50 px-3 py-2 text-xs font-bold text-slate-400">
            <div>Periodo</div><div>Número</div><div>Total</div>
          </div>
          {invoices.map((inv) => (
            <div key={inv.id} className="grid grid-cols-[1fr_1fr_0.7fr] border-t border-slate-100 px-3 py-2 text-sm">
              <div>{inv.period_start} - {inv.period_end}</div>
              <div>{inv.series}-{inv.number}</div>
              <div>{Number(inv.total).toFixed(2)} €</div>
            </div>
          ))}
          {invoices.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-400">Sin facturas todavía.</div>}
        </div>
      </div>
    </div>
  );
}

function CompanyModal({ company, profileId, onClose, onSaved }) {
  const isEdit = Boolean(company.id);
  const [serviceTypes, setServiceTypes] = useState([]);
  const [form, setForm] = useState({
    name: company.name || "",
    nif_cif: company.nif_cif || "",
    fiscal_address: company.fiscal_address || "",
    email: company.email || "",
    phone: company.phone || "",
    rates: {},
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("service_types").select("name, default_price").eq("active", true).order("name").then(({ data }) => {
      const types = data || [];
      setServiceTypes(types);
      setForm((prev) => {
        if (Object.keys(prev.rates).length) return prev; // ya cargadas (modo edición), no pisar
        const rates = {};
        types.forEach((t) => { rates[t.name] = String(t.default_price); });
        return { ...prev, rates };
      });
    });
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    supabase
      .from("company_rates")
      .select("service_type, price")
      .eq("company_id", company.id)
      .then(({ data }) => {
        if (!data) return;
        setForm((prev) => {
          const rates = { ...prev.rates };
          data.forEach((r) => { rates[r.service_type] = String(r.price); });
          return { ...prev, rates };
        });
      });
  }, [isEdit, company.id]);

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const updateRate = (type, value) => setForm((prev) => ({ ...prev, rates: { ...prev.rates, [type]: value } }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const payload = {
      name: form.name,
      nif_cif: form.nif_cif,
      fiscal_address: form.fiscal_address,
      email: form.email,
      phone: form.phone || null,
    };

    let companyId = company.id;

    if (isEdit) {
      const { error: updateError } = await supabase.from("companies").update(payload).eq("id", companyId);
      if (updateError) { setError("No se pudo actualizar la empresa."); setSaving(false); return; }
    } else {
      const { data: created, error: insertError } = await supabase
        .from("companies").insert({ ...payload, created_by: profileId }).select().single();
      if (insertError) { setError("No se pudo crear la empresa. Revisa los datos."); setSaving(false); return; }
      companyId = created.id;
    }

    const rateRows = Object.entries(form.rates)
      .filter(([, price]) => price !== "")
      .map(([service_type, price]) => ({ company_id: companyId, service_type, price: Number(price) }));

    if (rateRows.length) {
      await supabase.from("company_rates").upsert(rateRows, { onConflict: "company_id,service_type" });
    }

    if (!isEdit) {
      const { data: sessionData } = await supabase.auth.getSession();
      await supabase.functions.invoke("admin-actions", {
        body: { type: "invite_company", company_id: companyId, email: form.email },
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      });
    } else if (company.portal_user_id && form.email !== company.email) {
      // El portal de esta empresa ya estaba activo con otro email: sincronizamos el login
      const { data: sessionData } = await supabase.auth.getSession();
      await supabase.functions.invoke("admin-actions", {
        body: { type: "update_email", target: "company", id: company.portal_user_id, new_email: form.email },
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      });
    }

    setSaving(false);
    onSaved(isEdit ? `Empresa "${form.name}" actualizada.` : `Empresa "${form.name}" creada y se le envió el acceso al portal por email.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-[#092640]">{isEdit ? "Editar empresa" : "Nueva empresa"}</h2>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-2">
          <input required placeholder="Nombre de la empresa" value={form.name} onChange={(e) => updateField("name", e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          <input required placeholder="NIF / CIF" value={form.nif_cif} onChange={(e) => updateField("nif_cif", e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          <input required placeholder="Dirección fiscal" value={form.fiscal_address} onChange={(e) => updateField("fiscal_address", e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          <input required type="email" placeholder="Email (recibirá facturas y acceso)" value={form.email} onChange={(e) => updateField("email", e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          <input placeholder="Teléfono (opcional)" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />

          <div className="pt-2 text-xs font-bold text-slate-400">Tarifa pactada</div>
          {serviceTypes.map((t) => (
            <div key={t.name} className="grid grid-cols-[1fr_100px] items-center gap-2">
              <span className="text-sm">{t.name}</span>
              <input type="number" step="0.01" value={form.rates[t.name] ?? ""} onChange={(e) => updateRate(t.name, e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
            </div>
          ))}
          {serviceTypes.length === 0 && <p className="text-xs text-slate-400">No hay tipos de envío en el catálogo. Crea alguno en "Tarifas" primero.</p>}

          {error && <p className="text-sm font-medium text-[#e50914]">{error}</p>}

          <button type="submit" disabled={saving} className="mt-2 w-full rounded-xl bg-[#092640] px-4 py-3 text-sm font-black text-white disabled:opacity-60">
            {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear empresa"}
          </button>
        </form>
      </div>
    </div>
  );
}
