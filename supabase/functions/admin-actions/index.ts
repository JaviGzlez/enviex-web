// Edge Function: admin-actions
// Se ejecuta en el servidor de Supabase (no en el navegador), por eso puede usar
// permisos elevados de forma segura. El cliente nunca ve la clave service_role.
//
// Acciones soportadas (se indican con "type" en el body):
//   - create_staff:   crea un usuario interno (Admin o Gestor) y le manda invitación
//   - invite_company: manda la invitación de acceso al portal a una empresa ya creada

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = getServiceRoleKey();

function getServiceRoleKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const dict = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (dict) {
    try {
      const parsed = JSON.parse(dict);
      return parsed.default || Object.values(parsed)[0];
    } catch {
      return null;
    }
  }
  return null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// A donde debe llevar el enlace del email una vez aceptada la invitacion
// (nunca localhost, siempre la web real)
const SITE_URL = "https://www.enviex.es";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const callerToken = authHeader.replace("Bearer ", "");

    // Cliente "admin" con permisos totales (solo vive aquí, en el servidor)
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Comprobamos quién llama y que sea Admin de verdad, no nos fiamos del body
    const { data: callerUser, error: callerError } = await adminClient.auth.getUser(callerToken);
    if (callerError || !callerUser?.user) {
      return json({ error: "No autenticado" }, 401);
    }

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role, active")
      .eq("id", callerUser.user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.active) {
      return json({ error: "Solo un Admin puede hacer esto" }, 403);
    }

    const body = await req.json();

    if (body.type === "create_staff") {
      const { email, full_name, role } = body;
      if (!email || !full_name || !["admin", "gestor"].includes(role)) {
        return json({ error: "Datos incompletos" }, 400);
      }

const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${SITE_URL}/crm/login`,
      });
      if (inviteError) return json({ error: inviteError.message }, 400);

      const { error: profileError } = await adminClient.from("profiles").insert({
        id: invited.user.id,
        full_name,
        email,
        role,
        active: true,
      });
      if (profileError) return json({ error: profileError.message }, 400);

      return json({ ok: true });
    }

    if (body.type === "invite_company") {
      const { company_id, email } = body;
      if (!company_id || !email) return json({ error: "Datos incompletos" }, 400);

const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${SITE_URL}/crm/login`,
      });
      if (inviteError) return json({ error: inviteError.message }, 400);

      const { error: updateError } = await adminClient
        .from("companies")
        .update({ portal_user_id: invited.user.id })
        .eq("id", company_id);
      if (updateError) return json({ error: updateError.message }, 400);

      return json({ ok: true });
    }

    if (body.type === "delete_staff") {
      const { user_id } = body;
      if (!user_id) return json({ error: "Datos incompletos" }, 400);

      if (user_id === callerUser.user.id) {
        return json({ error: "No puedes borrarte a ti mismo" }, 400);
      }

      await adminClient.from("profiles").delete().eq("id", user_id);
      const { error: deleteError } = await adminClient.auth.admin.deleteUser(user_id);
      if (deleteError) return json({ error: deleteError.message }, 400);

      return json({ ok: true });
    }

    if (body.type === "update_email") {
      const { target, id, new_email } = body;
      if (!target || !id || !new_email) return json({ error: "Datos incompletos" }, 400);

      if (target === "staff") {
        const { error: authError } = await adminClient.auth.admin.updateUserById(id, { email: new_email });
        if (authError) return json({ error: authError.message }, 400);

        const { error: profileError } = await adminClient.from("profiles").update({ email: new_email }).eq("id", id);
        if (profileError) return json({ error: profileError.message }, 400);

        return json({ ok: true });
      }

      if (target === "company") {
        // "id" aquí es el portal_user_id (el login de esa empresa en el portal)
        const { error: authError } = await adminClient.auth.admin.updateUserById(id, { email: new_email });
        if (authError) return json({ error: authError.message }, 400);

        return json({ ok: true });
      }

      return json({ error: "Objetivo desconocido" }, 400);
    }

    return json({ error: "Tipo de acción desconocido" }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
