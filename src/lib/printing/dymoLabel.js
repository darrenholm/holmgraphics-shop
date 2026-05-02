// src/lib/printing/dymoLabel.js
//
// Dymo LabelWriter printing for Holm Graphics Shop.
//
// The LabelWriter is USB-attached to the RIP computer (10.10.1.30), so direct
// in-browser DYMO SDK calls can't reach it. We generate DYMO-compatible label
// XML here in the browser, then POST it to the print-bridge service on the
// RIP (see /print-bridge), which forwards it to DYMO Connect locally.
//
// CDN-on-demand libraries (matching the existing generateQuote() pattern):
//   • qrcode  — renders QR codes to a PNG data URL
//   • jsPDF   — PDF fallback, sized to the label

// ---------------------------------------------------------------------------
// Label size catalog  (dimensions in twips — Dymo's XML unit; 1 inch = 1440)
// ---------------------------------------------------------------------------
export const LABEL_SIZES = {
  '30334': {
    id: '30334',
    name: '30334 — Multi-Purpose (2¼" × 1¼")',
    widthIn:  2.25,
    heightIn: 1.25,
    paperName: '30334 2-1/4 in x 1-1/4 in'
  },
  '30336': {
    id: '30336',
    name: '30336 — Small Multi-Purpose (1" × 2⅛")',
    widthIn:  2.125,
    heightIn: 1,
    paperName: '30336 1 in x 2-1/8 in'
  },
  '30252': {
    id: '30252',
    name: '30252 — Address (1⅛" × 3½")',
    widthIn:  3.5,
    heightIn: 1.125,
    paperName: '30252 Address'
  },
  '30256': {
    id: '30256',
    name: '30256 — Shipping (2 5⁄16" × 4")',
    widthIn:  4,
    heightIn: 2.3125,
    paperName: '30256 Shipping'
  }
};

export const DEFAULT_LABEL_SIZE = '30252';

// ---------------------------------------------------------------------------
// CDN loaders  (idempotent — each returns the already-loaded global)
// ---------------------------------------------------------------------------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function loadQrious() {
  if (window.QRious) return window.QRious;
  // qrious is a small, browser-first QR library that reliably exposes a
  // global and outputs PNG via canvas.
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js');
  } catch {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js');
  }
  if (!window.QRious) throw new Error('QR code library failed to load');
  return window.QRious;
}

async function loadJsPdf() {
  if (window.jspdf) return window.jspdf;
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  if (!window.jspdf) throw new Error('jsPDF failed to load');
  return window.jspdf;
}

// ---------------------------------------------------------------------------
// QR code helper
// ---------------------------------------------------------------------------
export async function qrDataUrl(text, sizePx = 240) {
  const QRious = await loadQrious();
  const qr = new QRious({
    value: String(text ?? ''),
    size: sizePx,
    level: 'M',
    background: 'white',
    foreground: 'black',
    padding: null
  });
  // qrious' toDataURL defaults to image/png, which is exactly what DYMO's
  // ImageObject expects downstream.
  return qr.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// Default data builder from a `project` record (see src/lib/api/client.js)
// ---------------------------------------------------------------------------
export function buildLabelData(project, opts = {}) {
  const origin = (typeof window !== 'undefined' && window.location)
    ? window.location.origin
    : 'https://shop.holmgraphics.ca';

  return {
    clientName:  project.client_name || '—',
    jobNumber:   String(project.id ?? ''),
    jobName:     project.project_name || '',
    projectType: project.project_type || '',
    qrText:      opts.qrText || `${origin}/jobs/${project.id}`
  };
}

// ---------------------------------------------------------------------------
// DYMO Label XML builder
//
// We build a DieCutLabel XML with:
//   • a QR code on the left (as an embedded PNG image — more reliable than
//     Dymo's built-in BarcodeObject, which varies between SDK versions)
//   • three stacked text objects on the right: client, job, description
// ---------------------------------------------------------------------------
export async function buildDymoLabelXml(data, sizeId = DEFAULT_LABEL_SIZE) {
  const size = LABEL_SIZES[sizeId] || LABEL_SIZES[DEFAULT_LABEL_SIZE];
  const twW = Math.round(size.widthIn  * 1440);
  const twH = Math.round(size.heightIn * 1440);

  // Layout: QR occupies the left square (height - padding); text occupies the
  // remaining width. `gap` gives visible breathing room between the two so the
  // text never crowds the QR code.
  const pad   = 60;                 // outer margin in twips (~0.04")
  const gap   = 200;                // horizontal gap between QR and text (~0.14")
  const qrSide = twH - pad * 2;
  const qrX = pad;
  const qrY = pad;
  const textX = qrX + qrSide + gap;
  const textW = twW - textX - pad;

  // Generate QR PNG. Scale roughly to the target print size (300 dpi-ish).
  const qrPx = Math.max(180, Math.round((qrSide / 1440) * 300));
  const qrPng = await qrDataUrl(data.qrText, qrPx);
  const qrBase64 = qrPng.replace(/^data:image\/png;base64,/, '');

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const rowH = Math.max(180, Math.floor((twH - pad * 2) / 3));
  const line1Y = pad;
  const line2Y = pad + rowH;
  const line3Y = pad + rowH * 2;

  const textObj = (name, x, y, w, h, bold, size, text) => `
    <ObjectInfo>
      <TextObject>
        <Name>${name}</Name>
        <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
        <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
        <LinkedObjectName />
        <Rotation>Rotation0</Rotation>
        <IsMirrored>False</IsMirrored>
        <IsVariable>True</IsVariable>
        <HorizontalAlignment>Left</HorizontalAlignment>
        <VerticalAlignment>Middle</VerticalAlignment>
        <TextFitMode>ShrinkToFit</TextFitMode>
        <UseFullFontHeight>True</UseFullFontHeight>
        <Verticalized>False</Verticalized>
        <StyledText>
          <Element>
            <String>${esc(text)}</String>
            <Attributes>
              <Font Family="Arial" Size="${size}" Bold="${bold ? 'True' : 'False'}" Italic="False" Underline="False" Strikeout="False" />
              <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
            </Attributes>
          </Element>
        </StyledText>
      </TextObject>
      <Bounds X="${x}" Y="${y}" Width="${w}" Height="${h}" />
    </ObjectInfo>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>${size.id}</Id>
  <PaperName>${esc(size.paperName)}</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="${twH}" Height="${twW}" Rx="270" Ry="270" />
  </DrawCommands>
  <ObjectInfo>
    <ImageObject>
      <Name>QRCODE</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
      <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
      <LinkedObjectName />
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>False</IsVariable>
      <Image>${qrBase64}</Image>
      <ScaleMode>Uniform</ScaleMode>
      <BorderWidth>0</BorderWidth>
      <BorderColor Alpha="255" Red="0" Green="0" Blue="0" />
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
    </ImageObject>
    <Bounds X="${qrX}" Y="${qrY}" Width="${qrSide}" Height="${qrSide}" />
  </ObjectInfo>
  ${textObj('CLIENT',  textX, line1Y, textW, rowH, true,  8, data.clientName)}
  ${textObj('JOB',     textX, line2Y, textW, rowH, true, 11, `Job #${data.jobNumber}`)}
  ${textObj('JOBNAME', textX, line3Y, textW, rowH, false, 7, data.jobName)}
</DieCutLabel>`;
}

// ---------------------------------------------------------------------------
// Custom freeform-text label XML builder
//
// No project binding, no QR code. A single multi-line TextObject fills the
// label, with TextFitMode=ShrinkToFit so long content scales rather than
// overflowing. Newlines in the input become <LineBreak /> in the StyledText.
// Used by the "Print Custom Label" sidebar entry.
// ---------------------------------------------------------------------------
export function buildCustomLabelXml(text, sizeId = DEFAULT_LABEL_SIZE) {
  const size = LABEL_SIZES[sizeId] || LABEL_SIZES[DEFAULT_LABEL_SIZE];
  const twW = Math.round(size.widthIn  * 1440);
  const twH = Math.round(size.heightIn * 1440);

  const pad = 80;          // ~0.055" inner margin
  const x = pad;
  const y = pad;
  const w = twW - pad * 2;
  const h = twH - pad * 2;

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  // Split on newlines and emit a series of <Element>s separated by
  // <LineBreak />. Empty lines become empty Elements; ShrinkToFit handles
  // the resulting block height.
  const lines = String(text ?? '').split(/\r?\n/);
  const styledText = lines.map((line, i) => {
    const el = `
          <Element>
            <String>${esc(line)}</String>
            <Attributes>
              <Font Family="Arial" Size="14" Bold="False" Italic="False" Underline="False" Strikeout="False" />
              <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
            </Attributes>
          </Element>`;
    return i < lines.length - 1
      ? el + `\n          <LineBreak />`
      : el;
  }).join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>${size.id}</Id>
  <PaperName>${esc(size.paperName)}</PaperName>
  <DrawCommands>
    <RoundRectangle X="0" Y="0" Width="${twH}" Height="${twW}" Rx="270" Ry="270" />
  </DrawCommands>
  <ObjectInfo>
    <TextObject>
      <Name>CUSTOM</Name>
      <ForeColor Alpha="255" Red="0" Green="0" Blue="0" />
      <BackColor Alpha="0" Red="255" Green="255" Blue="255" />
      <LinkedObjectName />
      <Rotation>Rotation0</Rotation>
      <IsMirrored>False</IsMirrored>
      <IsVariable>True</IsVariable>
      <HorizontalAlignment>Center</HorizontalAlignment>
      <VerticalAlignment>Middle</VerticalAlignment>
      <TextFitMode>ShrinkToFit</TextFitMode>
      <UseFullFontHeight>True</UseFullFontHeight>
      <Verticalized>False</Verticalized>
      <StyledText>${styledText}
      </StyledText>
    </TextObject>
    <Bounds X="${x}" Y="${y}" Width="${w}" Height="${h}" />
  </ObjectInfo>
</DieCutLabel>`;
}

// ---------------------------------------------------------------------------
// PDF fallback — sized exactly to the physical label
// ---------------------------------------------------------------------------
export async function downloadLabelPdf(data, sizeId = DEFAULT_LABEL_SIZE, filename) {
  const size = LABEL_SIZES[sizeId] || LABEL_SIZES[DEFAULT_LABEL_SIZE];
  const jspdf = await loadJsPdf();
  const { jsPDF } = jspdf;

  const doc = new jsPDF({
    orientation: size.widthIn > size.heightIn ? 'landscape' : 'portrait',
    unit: 'in',
    format: [size.widthIn, size.heightIn]
  });

  const pad = 0.08;
  const qrSide = size.heightIn - pad * 2;
  const qrPng = await qrDataUrl(data.qrText, 400);
  doc.addImage(qrPng, 'PNG', pad, pad, qrSide, qrSide);

  const textX = pad + qrSide + pad;
  const textW = size.widthIn - textX - pad;
  const rowH  = (size.heightIn - pad * 2) / 3;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(clip(doc, data.clientName, textW), textX, pad + rowH * 0.65);

  doc.setFontSize(12);
  doc.text(clip(doc, `Job #${data.jobNumber}`, textW), textX, pad + rowH * 1.65);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const desc = doc.splitTextToSize(data.jobName || '', textW);
  doc.text(desc.slice(0, 2), textX, pad + rowH * 2.4);

  doc.save(filename || `Label-Job-${data.jobNumber}.pdf`);
}

function clip(doc, text, maxWidth) {
  if (!text) return '';
  const w = doc.getTextWidth(text);
  if (w <= maxWidth) return text;
  let s = text;
  while (s.length > 3 && doc.getTextWidth(s + '…') > maxWidth) s = s.slice(0, -1);
  return s + '…';
}
