import React, { useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "../supabaseClient.js";
import { useAuth } from "../AuthContext.jsx";

export default function UsuariosPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [notice, setNotice] = useState("");

  const loadUsers = () => {
    supabase
      .from("profiles")
      .select("id, full_name, email, role, active")
      .order("full_name")
      .then(({ data }) => setUsers(data || []));
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const sendPasswordReset = async (u) => {
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
      redirectTo: "https://www.enviex.es/crm/login",
    });
    if (error) {
      setNotice(`No se pudo enviar la recuperación a ${u.email}: ${error.message}`);
      return;
    }
    setNotice(`Se envió un email de recuperación de contraseña a ${u.email}.`);
  };

  const deleteUser = async (u) => {
    if (u.id === user.id) {
      alert("No puedes borrar tu propia cuenta.");
      return;
    }
    if (!window.confirm(`¿Borrar permanentemente a ${u.full_name}? Perderá el acceso al CRM inmediatamente.`)) return;

    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("admin-actions", {
      body: { type: "delete_staff", user_id: u.id },
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    });
    if (error || data?.error) {
      setNotice(data?.error || "No se pudo borrar el usuario.");
      return;
    }
    setNotice(`${u.full_name} se borró correctamente.`);
    loadUsers();
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-black text-[#092640]">Usuarios internos</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-xl bg-[#092640] px-4 py-2 text-sm font-black text-white"
        >
          <Plus size={16} /> Nuevo usuario
        </button>
      </div>

      {notice && <p className="mb-3 text-sm font-medium text-green-700">{notice}</p>}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.3fr_1.3fr_0.7fr_0.6fr_0.7fr] bg-slate-50 px-4 py-2 text-xs font-bold text-slate-400">
          <div>Nombre</div>
          <div>Email</div>
          <div>Rol</div>
          <div>Estado</div>
          <div>Acciones</div>
        </div>
        {users.map((u) => (
          <div key={u.id} className="grid grid-cols-[1.3fr_1.3fr_0.7fr_0.6fr_0.7fr] items-center border-t border-slate-100 px-4 py-3 text-sm">
            <div className="capitalize">{u.full_name}</div>
            <div className="truncate text-slate-500">{u.email}</div>
            <div className="capitalize">{u.role}</div>
            <div>{u.active ? "Activo" : "Inactivo"}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setEditingUser(u)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Editar nombre o email">
                <Pencil size={15} />
              </button>
              <button onClick={() => sendPasswordReset(u)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Enviar recuperación de contraseña">
                <KeyRound size={15} />
              </button>
              <button onClick={() => deleteUser(u)} className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-[#e50914]" title="Borrar usuario">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <NewUserModal
          onClose={() => setShowForm(false)}
          onCreated={(message) => {
            setShowForm(false);
            setNotice(message);
            loadUsers();
          }}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={(message) => {
            setEditingUser(null);
            setNotice(message);
            loadUsers();
          }}
        />
      )}
    </div>
  );
}

function NewUserModal({ onClose, onCreated }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("gestor");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const { data: sessionData } = await supabase.auth.getSession();
    const { data, error: fnError } = await supabase.functions.invoke("admin-actions", {
      body: { type: "create_staff", email, full_name: fullName, role },
      headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
    });

    setSaving(false);

    if (fnError || data?.error) {
      setError(data?.error || "No se pudo crear el usuario.");
      return;
    }

    onCreated(`Se envió una invitación a ${email} para que active su cuenta como ${role}.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-[#092640]">Nuevo usuario interno</h2>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input required placeholder="Nombre completo" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          <input required type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            <button type="button" onClick={() => setRole("gestor")} className={`rounded-lg py-2 text-sm font-black ${role === "gestor" ? "bg-white text-[#092640]" : "text-slate-500"}`}>Gestor</button>
            <button type="button" onClick={() => setRole("admin")} className={`rounded-lg py-2 text-sm font-black ${role === "admin" ? "bg-white text-[#092640]" : "text-slate-500"}`}>Admin</button>
          </div>

          {error && <p className="text-sm font-medium text-[#e50914]">{error}</p>}

          <button type="submit" disabled={saving} className="w-full rounded-xl bg-[#e50914] px-4 py-3 text-sm font-black text-white disabled:opacity-60">
            {saving ? "Enviando invitación..." : "Crear e invitar"}
          </button>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({ user, onClose, onSaved }) {
  const [fullName, setFullName] = useState(user.full_name || "");
  const [email, setEmail] = useState(user.email || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    // El nombre se puede cambiar directamente
    if (fullName !== user.full_name) {
      const { error: nameError } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
      if (nameError) {
        setError("No se pudo guardar el nombre.");
        setSaving(false);
        return;
      }
    }

    // El email hay que cambiarlo también en el login, así que pasa por la función de servidor
    if (email !== user.email) {
      const { data: sessionData } = await supabase.auth.getSession();
      const { data, error: fnError } = await supabase.functions.invoke("admin-actions", {
        body: { type: "update_email", target: "staff", id: user.id, new_email: email },
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      });
      if (fnError || data?.error) {
        setError(data?.error || "No se pudo actualizar el email.");
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSaved(`${fullName} actualizado correctamente.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-[#092640]">Editar usuario</h2>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input required placeholder="Nombre completo" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          <input required type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          {email !== user.email && (
            <p className="text-xs text-amber-600">
              Al cambiar el email, la próxima vez que {fullName.split(" ")[0]} entre tendrá que usar el email nuevo para iniciar sesión.
            </p>
          )}

          {error && <p className="text-sm font-medium text-[#e50914]">{error}</p>}

          <button type="submit" disabled={saving} className="w-full rounded-xl bg-[#092640] px-4 py-3 text-sm font-black text-white disabled:opacity-60">
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </form>
      </div>
    </div>
  );
}
