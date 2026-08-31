// Edge Function: generate-monthly-invoices
// Dos modos de uso:
//  1) Automático: se llama sin datos (o {}) desde el Cron Job el día 1 de cada mes,
//     y factura a TODAS las empresas activas sus envíos pendientes.
//  2) Bajo demanda: se llama con { company_id, period_end } (period_end opcional,
//     por defecto hoy) para facturar YA a una sola empresa, cuando tú quieras.
// Es segura de repetir: un envío ya facturado no se vuelve a facturar.

import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import qrcodegen from "npm:qrcode-generator@1.4.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = getServiceRoleKey();
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

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
const EMISOR = {
  nombre: "José Carlos Ortiz Cervera (Enviex)",
  nif: "32056045W",
  direccion: "Calle Higueras, 3, 11402 Jerez de la Frontera, Cádiz",
  email: "operativa@enviex.es",
};
const IVA_RATE = 0.21;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Edge Function: generate-monthly-invoices
// Tres modos de uso:
//  1) Crear borradores en automático: se llama sin datos (o {}) desde el Cron
//     Job el día 1 de cada mes. Crea un BORRADOR por cada empresa con envíos
//     pendientes — no manda nada, no asigna número todavía.
//  2) Crear un borrador bajo demanda: { company_id, period_end } (period_end
//     opcional, por defecto hoy). Igual que arriba pero para una sola empresa,
//     cuando tú quieras.
//  3) Enviar de verdad: { finalize_invoice_id }. Coge un borrador ya revisado
//     (y quizá editado a mano), le asigna número/hash/QR, genera el PDF
//     definitivo y lo manda por email. A partir de aquí ya no se puede editar.
// Es segura de repetir: un envío ya incluido en un borrador no se duplica.

import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import qrcodegen from "npm:qrcode-generator@1.4.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = getServiceRoleKey();
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

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
const EMISOR = {
  nombre: "José Carlos Ortiz Cervera (Enviex)",
  nif: "32056045W",
  direccion: "Calle Higueras, 3, 11402 Jerez de la Frontera, Cádiz",
  email: "operativa@enviex.es",
};
const IVA_RATE = 0.21;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const isUserTriggered = Boolean(body.company_id) || Boolean(body.finalize_invoice_id);

  if (isUserTriggered) {
    const authHeader = req.headers.get("Authorization") || "";
    const callerToken = authHeader.replace("Bearer ", "");
    const { data: callerUser } = await supabase.auth.getUser(callerToken);
    if (!callerUser?.user) {
      return json({ error: "No autenticado" }, 401);
    }
    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role, active")
      .eq("id", callerUser.user.id)
      .maybeSingle();
    if (!callerProfile || !callerProfile.active || !["admin", "gestor"].includes(callerProfile.role)) {
      return json({ error: "No autorizado" }, 403);
    }
  }

  // ---------- Modo 3: enviar de verdad un borrador ya revisado ----------
  if (body.finalize_invoice_id) {
    const result = await finalizeInvoice(supabase, body.finalize_invoice_id);
    if (result.error) return json({ error: result.error }, 400);
    return json({ ok: true, invoice: result.invoice });
  }

  // ---------- Modo 1 y 2: crear borrador(es) ----------
  const onDemand = Boolean(body.company_id);
  const now = new Date();

  const periodEndStr = onDemand
    ? (body.period_end || toISODate(now))
    : toISODate(new Date(now.getFullYear(), now.getMonth(), 0));

  let companiesQuery = supabase
    .from("companies")
    .select("id, name")
    .eq("active", true);

  if (onDemand) {
    companiesQuery = companiesQuery.eq("id", body.company_id);
  }

  const { data: companies } = await companiesQuery;
  const results = [];

  for (const company of companies || []) {
    const { data: shipments } = await supabase
      .from("shipments")
      .select("id, shipment_date, service_type, concept, price")
      .eq("company_id", company.id)
      .is("invoice_id", null)
      .lte("shipment_date", periodEndStr);

    if (!shipments || shipments.length === 0) continue;

    const periodStartStr = shipments.map((s) => s.shipment_date).sort()[0];
    const subtotal = round2(shipments.reduce((sum, s) => sum + Number(s.price), 0));
    const ivaAmount = round2(subtotal * IVA_RATE);
    const total = round2(subtotal + ivaAmount);

    const { data: invoice } = await supabase
      .from("invoices")
      .insert({
        company_id: company.id,
        period_start: periodStartStr,
        period_end: periodEndStr,
        subtotal, iva_rate: IVA_RATE, iva_amount: ivaAmount, total,
        status: "draft",
      })
      .select()
      .single();

    await supabase.from("invoice_lines").insert(
      shipments.map((s) => ({
        invoice_id: invoice.id,
        shipment_id: s.id,
        description: s.concept ? `${s.service_type} — ${s.concept}` : s.service_type,
        price: s.price,
      }))
    );

    await supabase.from("shipments").update({ invoice_id: invoice.id }).in("id", shipments.map((s) => s.id));

    results.push({ company: company.name, invoice_id: invoice.id, total });
  }

  return json({ ok: true, generated: results });
});

async function finalizeInvoice(supabase, invoiceId) {
  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, companies(id, name, nif_cif, fiscal_address, email)")
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice) return { error: "Factura no encontrada" };
  if (invoice.status !== "draft") return { error: "Esta factura ya no está en borrador" };

  const { data: lines } = await supabase
    .from("invoice_lines")
    .select("id, shipment_id, description, price")
    .eq("invoice_id", invoiceId);

  if (!lines || lines.length === 0) return { error: "El borrador no tiene ninguna línea" };

  // Recuperamos la fecha real de los envíos que sigan ligados a la línea
  // (las líneas añadidas a mano no tienen envío asociado, usamos la fecha de cierre)
  const shipmentIds = lines.map((l) => l.shipment_id).filter(Boolean);
  let datesByShipment = {};
  if (shipmentIds.length) {
    const { data: shipmentDates } = await supabase
      .from("shipments")
      .select("id, shipment_date")
      .in("id", shipmentIds);
    datesByShipment = Object.fromEntries((shipmentDates || []).map((s) => [s.id, s.shipment_date]));
  }

  const company = invoice.companies;
  const now = new Date();

  // Recalculamos los totales por si se editó algo en el borrador
  const subtotal = round2(lines.reduce((sum, l) => sum + Number(l.price), 0));
  const ivaAmount = round2(subtotal * IVA_RATE);
  const total = round2(subtotal + ivaAmount);

  const { data: seq } = await supabase
    .from("invoice_sequences_v2")
    .select("series, next_number")
    .eq("company_id", company.id)
    .maybeSingle();

  const series = seq?.series || "A";
  const currentNumber = seq?.next_number ?? 1;
  await supabase
    .from("invoice_sequences_v2")
    .upsert({ company_id: company.id, series, next_number: currentNumber + 1 });
  const number = `${now.getFullYear()}-${String(currentNumber).padStart(5, "0")}`;

  const { data: lastInvoice } = await supabase
    .from("invoices")
    .select("hash")
    .eq("company_id", company.id)
    .eq("status", "issued")
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previousHash = lastInvoice?.hash || "GENESIS";

  const issuedAt = toISODate(now);
  const hashInput = `${EMISOR.nif}|${series}-${number}|${issuedAt}|${total}|${previousHash}`;
  const hash = await sha256Hex(hashInput);
  const qrData = `NIF:${EMISOR.nif};NUM:${series}-${number};FECHA:${issuedAt};TOTAL:${total};HASH:${hash.slice(0, 16)}`;

  // Para el PDF necesitamos "envíos" con fecha/tipo — los reconstruimos desde las líneas
  const shipmentsForPdf = lines.map((l) => ({
    shipment_date: datesByShipment[l.shipment_id] || invoice.period_end,
    service_type: l.description,
    concept: "",
    price: l.price,
  }));

  const pdfBytes = await buildInvoicePdf({
    series, number, issuedAt,
    periodStartStr: invoice.period_start, periodEndStr: invoice.period_end,
    company, shipments: shipmentsForPdf, subtotal, ivaAmount, total,
    hash, previousHash, qrData,
  });

  const path = `${company.id}/${series}-${number}.pdf`;
  await supabase.storage.from("invoices").upload(path, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });

  const { data: updatedInvoice } = await supabase
    .from("invoices")
    .update({
      series, number, subtotal, iva_rate: IVA_RATE, iva_amount: ivaAmount, total,
      status: "issued",
      hash, previous_hash: previousHash,
      qr_data: qrData,
      pdf_url: path,
      issued_at: now.toISOString(),
    })
    .eq("id", invoiceId)
    .select()
    .single();

  await supabase.from("event_log").insert({
    event_type: "invoice_issued",
    entity_type: "invoice",
    entity_id: invoiceId,
    details: { company: company.name, total },
    hash,
    previous_hash: previousHash,
  });

  if (RESEND_API_KEY) {
    await sendInvoiceEmail(company, series, number, total, pdfBytes);
  }

  return { invoice: { number: `${series}-${number}`, total } };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000; // trozos de 32KB para no reventar el límite de argumentos
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sendInvoiceEmail(company, series, number, total, pdfBytes) {
  const base64 = bytesToBase64(pdfBytes);
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Enviex <facturas@enviex.es>",
      to: company.email,
      subject: `Factura Enviex ${series}-${number}`,
      html: `<p>Hola,</p><p>Adjuntamos vuestra factura de Enviex. Total: <strong>${total} €</strong>.</p><p>También puedes consultarla en tu portal de Enviex.</p>`,
      attachments: [{ filename: `factura-${series}-${number}.pdf`, content: base64 }],
    }),
  });
}

async function buildInvoicePdf({ series, number, issuedAt, periodStartStr, periodEndStr, company, shipments, subtotal, ivaAmount, total, hash, previousHash, qrData }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const NAVY = rgb(9 / 255, 38 / 255, 64 / 255);
  const GRAY = rgb(0.37, 0.36, 0.35);
  const LIGHT = rgb(241 / 255, 239 / 255, 232 / 255);

  // Logo real de Enviex (mismo que en la web)
  let logoImage = null;
  try {
    const logoBytes = await fetch("https://www.enviex.es/logo-enviex.png").then((r) => r.arrayBuffer());
    logoImage = await doc.embedPng(logoBytes);
  } catch {
    // Si por lo que sea no se puede descargar el logo, seguimos sin él en vez de romper la factura
  }

  let y = 800;

  if (logoImage) {
    const logoSize = 55;
    page.drawImage(logoImage, { x: 40, y: y - logoSize + 15, width: logoSize, height: logoSize });
  } else {
    page.drawText("enviex", { x: 40, y, size: 22, font: bold, color: NAVY });
  }

  page.drawText("FACTURA", { x: 460, y, size: 16, font: bold, color: NAVY });
  page.drawText(`Nº ${series}-${number}`, { x: 460, y: y - 16, size: 9.5, font, color: GRAY });
  page.drawText(`Fecha: ${issuedAt}`, { x: 460, y: y - 29, size: 9.5, font, color: GRAY });
  page.drawLine({ start: { x: 40, y: y - 40 }, end: { x: 555, y: y - 40 }, thickness: 1, color: NAVY });

  y -= 65;
  page.drawText("EMISOR", { x: 40, y, size: 9, font: bold, color: NAVY });
  page.drawText("CLIENTE", { x: 310, y, size: 9, font: bold, color: NAVY });
  const emisorLines = [EMISOR.nombre, `NIF: ${EMISOR.nif}`, EMISOR.direccion, EMISOR.email];
  const clienteLines = [company.name, `NIF: ${company.nif_cif}`, company.fiscal_address];
  emisorLines.forEach((line, i) => page.drawText(line, { x: 40, y: y - 15 - i * 13, size: 9, font, color: rgb(0, 0, 0) }));
  clienteLines.forEach((line, i) => page.drawText(line, { x: 310, y: y - 15 - i * 13, size: 9, font, color: rgb(0, 0, 0) }));

  y -= 95;
  page.drawText(`Periodo facturado: ${periodStartStr} - ${periodEndStr}`, { x: 40, y, size: 9, font, color: GRAY });

  y -= 25;
  const cols = [40, 100, 220, 375, 415, 470];
  page.drawRectangle({ x: 40, y: y - 5, width: 515, height: 20, color: NAVY });
  ["Fecha", "Tipo de envío", "Concepto", "Cant.", "Precio/ud.", "Importe"].forEach((h, i) =>
    page.drawText(h, { x: cols[i] + 4, y: y, size: 8, font: bold, color: rgb(1, 1, 1) })
  );

  // Agrupamos por fecha + tipo de envío + concepto, para desglosar bien la factura
  const grouped = {};
  shipments.forEach((s) => {
    const key = `${s.shipment_date}|${s.service_type}|${s.concept || ""}`;
    grouped[key] = grouped[key] || { date: s.shipment_date, type: s.service_type, concept: s.concept || "—", count: 0, total: 0, unit: s.price };
    grouped[key].count += 1;
    grouped[key].total += Number(s.price);
  });

  y -= 20;
  const rowHeight = 20;
  Object.values(grouped)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((g, i) => {
      if (i % 2 === 0) {
        page.drawRectangle({ x: 40, y: y - 5, width: 515, height: rowHeight, color: LIGHT });
      }
      page.drawText(formatDate(g.date), { x: cols[0] + 4, y, size: 8, font });
      page.drawText(truncate(g.type, 18), { x: cols[1] + 4, y, size: 8, font });
      page.drawText(truncate(g.concept, 24), { x: cols[2] + 4, y, size: 8, font, color: GRAY });
      page.drawText(String(g.count), { x: cols[3] + 4, y, size: 8, font });
      page.drawText(`${Number(g.unit).toFixed(2)} €`, { x: cols[4] + 4, y, size: 8, font });
      page.drawText(`${g.total.toFixed(2)} €`, { x: cols[5] + 4, y, size: 8, font });
      y -= rowHeight;
    });

  y -= 10;
  page.drawLine({ start: { x: 40, y: y + rowHeight - 5 }, end: { x: 555, y: y + rowHeight - 5 }, thickness: 0.5, color: rgb(0.83, 0.82, 0.78) });

  y -= 10;
  page.drawText("Subtotal:", { x: 400, y, size: 9.5, font });
  page.drawText(`${subtotal.toFixed(2)} €`, { x: 480, y, size: 9.5, font });
  y -= 15;
  page.drawText("IVA (21%):", { x: 400, y, size: 9.5, font });
  page.drawText(`${ivaAmount.toFixed(2)} €`, { x: 480, y, size: 9.5, font });
  y -= 22;
  page.drawRectangle({ x: 370, y: y - 4, width: 185, height: 22, color: NAVY });
  page.drawText("TOTAL:", { x: 400, y: y + 2, size: 11, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`${total.toFixed(2)} €`, { x: 480, y: y + 2, size: 11, font: bold, color: rgb(1, 1, 1) });

  // Bloque de QR + huella: siempre pegado a la parte baja de la página,
  // con el mismo margen que el resto del documento (no depende de cuántas líneas tenga la tabla)
  const footerTop = 190;
  const qrSize = 70;
  const qr = qrcodegen(0, "M");
  qr.addData(qrData);
  qr.make();
  const moduleCount = qr.getModuleCount();
  const cell = qrSize / moduleCount;
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        page.drawRectangle({
          x: 40 + col * cell,
          y: footerTop - qrSize - row * cell,
          width: cell,
          height: cell,
          color: rgb(0, 0, 0),
        });
      }
    }
  }

  page.drawText("Registro de facturación seguro (Reglamento RD 1007/2023)", { x: 125, y: footerTop - 15, size: 8.5, font: bold, color: NAVY });
  page.drawText(`Huella (hash): ${hash.slice(0, 40)}...`, { x: 125, y: footerTop - 29, size: 7.5, font, color: GRAY });
  page.drawText(`Huella anterior: ${previousHash === "GENESIS" ? "— (primera factura)" : previousHash.slice(0, 40) + "..."}`, { x: 125, y: footerTop - 41, size: 7.5, font, color: GRAY });
  page.drawText("Modalidad: No VERI*FACTU · registros disponibles a petición de la AEAT", { x: 125, y: footerTop - 53, size: 7.5, font, color: GRAY });

  page.drawText(`Enviex · ${EMISOR.direccion} · ${EMISOR.email}`, { x: 150, y: 40, size: 7.5, font, color: GRAY });

  return doc.save();
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
