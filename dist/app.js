const pdfjsLib = window.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

const natures = ["Restaurant", "Parking", "Autoroute", "Tramway", "Taxi", "Hôtel", "Carburant", "Fournitures", "Téléphone", "Divers"];
const monthLabels = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const natureRules = [
  ["Restaurant", /restaurant|brasserie|bistrot|café|cafe|boulangerie|traiteur|restauration/i],
  ["Parking", /parking|parcmètre|horodateur/i], ["Autoroute", /autoroute|péage|peage|toll/i],
  ["Tramway", /tramway|métro|metro|bus|transport urbain/i], ["Taxi", /taxi|uber|bolt|vtc/i],
  ["Hôtel", /hôtel|hotel|hébergement|hebergement|ibis|mercure|novotel/i],
  ["Carburant", /carburant|gazole|diesel|essence|station-service|totalenergies|shell|esso/i],
  ["Fournitures", /fourniture|papeterie|bureau|office|cartouche|imprimante/i], ["Téléphone", /téléphone|telephone|mobile|orange|sfr|bouygues|free/i]
];
const supplierRules = [["Uber", /\buber\b/i], ["TotalEnergies", /total\s*energies/i], ["SNCF", /\bsncf\b/i], ["Ibis", /\bibis\b/i], ["Carrefour", /\bcarrefour\b/i], ["Leclerc", /\bleclerc\b/i]];
const records = [];
let ocrWorker;

const fileInput = document.querySelector("#fileInput");
const jsonInput = document.querySelector("#jsonInput");
const dropZone = document.querySelector("#dropZone");
const documentList = document.querySelector("#documentList");
const resultsBody = document.querySelector("#resultsBody");
const progress = document.querySelector("#progress");
const exportCsvButton = document.querySelector("#exportCsv");
const exportJsonButton = document.querySelector("#exportJson");
const showStatsButton = document.querySelector("#showStats");
const chooseSourceFolderButton = document.querySelector("#chooseSourceFolder");
const rawTextDialog = document.querySelector("#rawTextDialog");
const previewDialog = document.querySelector("#previewDialog");
let sourceFolderHandle = null;
const statsDialog = document.querySelector("#statsDialog");

function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function confidence(score) { return score >= 80 ? "forte" : score >= 55 ? "moyenne" : "faible"; }
function confidenceClass(level) { return level === "forte" ? "high" : level === "moyenne" ? "medium" : "low"; }
function scoreForConfidence(level) { return level === "forte" ? 85 : level === "moyenne" ? 65 : 35; }
function makeField(value = "", score = 0, rule = "Aucune valeur trouvée") { return { value, confidence: confidence(score), score, rule, original: value, edited: false }; }
function selectedStatus(record) { const key = [record.month, record.supplier, record.amount].map(field => field.confidence); return key.includes("faible") ? "À vérifier" : key.every(level => level === "forte") ? "Reconnu" : "À vérifier"; }
function normalizeAmount(value) { return Number(String(value).replace(/\s/g, "").replace(",", ".")); }
function amountText(value) { return Number.isFinite(normalizeAmount(value)) ? normalizeAmount(value).toFixed(2).replace(".", ",") : value; }

async function getOcrWorker() {
  if (!ocrWorker) ocrWorker = await window.Tesseract.createWorker(["fra", "eng"], 1, { logger: message => { if (message.status === "recognizing text") progress.textContent = `OCR en cours : ${Math.round((message.progress || 0) * 100)} %`; } });
  return ocrWorker;
}
async function ocrImage(source) { const worker = await getOcrWorker(); const result = await worker.recognize(source); return { text: result.data.text || "", ocrScore: Math.round(result.data.confidence || 0), source: "OCR" }; }
async function readPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  let text = "";
  for (let number = 1; number <= pdf.numPages; number += 1) { const page = await pdf.getPage(number); const content = await page.getTextContent(); text += `${content.items.map(item => item.str).join(" ")}\n`; }
  if (text.replace(/\s/g, "").length >= 25) return { text, ocrScore: 96, source: "Texte du PDF" };
  const renderedPages = [];
  for (let number = 1; number <= pdf.numPages; number += 1) { const page = await pdf.getPage(number); const viewport = page.getViewport({ scale: 2 }); const canvas = document.createElement("canvas"); canvas.width = viewport.width; canvas.height = viewport.height; await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise; renderedPages.push(canvas.toDataURL("image/png")); }
  const readings = []; for (const image of renderedPages) readings.push(await ocrImage(image));
  return { text: readings.map(reading => reading.text).join("\n"), ocrScore: Math.round(readings.reduce((sum, reading) => sum + reading.ocrScore, 0) / readings.length), source: "OCR du PDF scanné" };
}
async function readDocument(file) { return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? readPdf(file) : ocrImage(file); }

function detectMonth(text, ocrScore) { const matches = [...text.matchAll(/\b\d{1,2}[\/.\-](\d{1,2})[\/.\-](?:\d{2}|\d{4})\b/g)]; if (matches.length) { const index = Number(matches[0][1]) - 1; if (monthLabels[index]) return makeField(monthLabels[index], Math.min(92, ocrScore), "Mois déduit de la première date détectée"); } const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR"); const index = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"].findIndex(month => new RegExp(`\\b${month}\\b`).test(normalized)); return index >= 0 ? makeField(monthLabels[index], Math.min(72, ocrScore), "Nom du mois détecté dans le texte") : makeField(); }
function detectAmount(text, ocrScore) { const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean); const labelled = lines.find(line => /total\s*(ttc|à payer|a payer)?|montant\s*(ttc|total)?/i.test(line)); const source = labelled || text; const matches = [...source.matchAll(/(?:€|eur)?\s*(\d{1,5}(?:[ .]\d{3})*[,.]\d{2})\s*(?:€|eur)?/gi)]; if (!matches.length) return makeField(); const values = matches.map(match => ({ raw: match[1], value: normalizeAmount(match[1]) })).filter(item => Number.isFinite(item.value)); if (!values.length) return makeField(); const selected = labelled ? values[values.length - 1] : values.sort((a, b) => b.value - a.value)[0]; return makeField(amountText(selected.raw), labelled ? Math.min(94, ocrScore) : Math.min(58, ocrScore), labelled ? "Montant associé à un libellé total/TTC" : "Montant le plus élevé détecté"); }
function detectSupplier(text, ocrScore) { for (const [name, expression] of supplierRules) if (expression.test(text)) return makeField(name, Math.min(92, ocrScore), "Fournisseur reconnu par dictionnaire"); const line = text.split(/\n+/).map(value => value.trim()).find(value => value.length > 2 && value.length < 70 && /[a-zà-ÿ]/i.test(value) && !/ticket|facture|total|tva|date|merci/i.test(value)); return line ? makeField(line.replace(/\s+/g, " "), Math.min(62, ocrScore), "Première ligne exploitable") : makeField(); }
function detectNature(text, supplier) { const material = `${supplier.value}\n${text}`; const found = natureRules.find(([, expression]) => expression.test(material)); return found ? makeField(found[0], supplier.confidence === "forte" ? 82 : 70, "Mot-clé ou fournisseur associé") : makeField("Divers", 35, "Nature par défaut : à vérifier"); }
function interpret(file, reading) { const month = detectMonth(reading.text, reading.ocrScore); const supplier = detectSupplier(reading.text, reading.ocrScore); const amount = detectAmount(reading.text, reading.ocrScore); const nature = detectNature(reading.text, supplier); const record = { id: crypto.randomUUID(), name: file.name, rawText: reading.text, readingSource: reading.source, ocrScore: reading.ocrScore, month, supplier, nature, amount, status: "" }; record.status = selectedStatus(record); return record; }

function renderDocuments(processingId = "") { documentList.innerHTML = records.length ? records.map(record => `<li class="${record.id === processingId ? "processing" : record.error ? "failed" : "done"}">${escapeHtml(record.name)} — ${record.id === processingId ? "analyse…" : record.error ? "non lu" : record.readingSource}</li>`).join("") : '<li class="empty">Aucun document importé.</li>'; }
function fieldInput(record, field) { const data = record[field]; return `<input data-id="${record.id}" data-field="${field}" value="${escapeHtml(data.value)}" aria-label="${field}" />`; }
function monthInput(record) { return `<select data-id="${record.id}" data-field="month" aria-label="Mois"><option value="">Non défini</option>${monthLabels.map(month => `<option ${month === record.month.value ? "selected" : ""}>${month}</option>`).join("")}</select>`; }
function renderResults() { resultsBody.innerHTML = records.length ? records.map(record => `<tr><td class="filename" title="${escapeHtml(record.name)}"><button class="file-button" data-preview="${record.id}">${escapeHtml(record.name)}</button></td><td>${monthInput(record)}</td><td>${fieldInput(record, "supplier")}</td><td><select data-id="${record.id}" data-field="nature">${natures.map(nature => `<option ${nature === record.nature.value ? "selected" : ""}>${nature}</option>`).join("")}</select></td><td>${fieldInput(record, "amount")}</td><td><span class="confidence ${confidenceClass(overallConfidence(record))}" title="${escapeHtml(confidenceDetails(record))}">${overallConfidence(record)}</span></td><td><select data-id="${record.id}" data-field="status">${["Reconnu", "À vérifier", "Saisie manuelle"].map(status => `<option ${status === record.status ? "selected" : ""}>${status}</option>`).join("")}</select></td><td><button class="text-button" data-raw-text="${record.id}">Afficher</button></td></tr>`).join("") : '<tr><td colspan="8" class="empty">Les résultats apparaîtront ici.</td></tr>'; const validatedCount = validatedRecords().length; exportCsvButton.disabled = validatedCount === 0; exportJsonButton.disabled = records.length === 0; exportCsvButton.textContent = `Exporter CSV validé (${validatedCount})`; exportJsonButton.textContent = `Sauvegarder le travail JSON (${records.length})`; showStatsButton.disabled = records.length === 0; }
function overallConfidence(record) { const scores = [record.month.score, record.supplier.score, record.nature.score, record.amount.score]; return confidence(Math.min(...scores)); }
function confidenceDetails(record) { return `Mois : ${record.month.confidence}; fournisseur : ${record.supplier.confidence}; nature : ${record.nature.confidence}; montant : ${record.amount.confidence}.`; }
function renderAll(processingId = "") { renderDocuments(processingId); renderResults(); }

async function importFiles(files) { const accepted = [...files].filter(file => file.type === "application/pdf" || file.type === "image/jpeg" || file.type === "image/png" || /\.(pdf|jpe?g|png)$/i.test(file.name)); if (!accepted.length) { progress.textContent = "Choisissez un PDF, JPG ou PNG."; return; } for (const file of accepted) { const placeholder = { id: crypto.randomUUID(), name: file.name, previewUrl: URL.createObjectURL(file), previewType: file.type, readingSource: "en attente", rawText: "", month: makeField(), supplier: makeField(), nature: makeField(), amount: makeField(), status: "À vérifier" }; records.push(placeholder); renderAll(placeholder.id); progress.textContent = `Analyse de ${file.name}…`; try { Object.assign(placeholder, interpret(file, await readDocument(file))); } catch (error) { placeholder.error = true; placeholder.readingSource = "erreur de lecture"; placeholder.rawText = `Erreur de lecture : ${error.message}`; placeholder.status = "Saisie manuelle"; progress.textContent = `Lecture impossible pour ${file.name} : consultez « Afficher » pour le détail.`; } renderAll(); } if (!records.some(record => record.error)) progress.textContent = `${records.length} document${records.length > 1 ? "s" : ""} analysé${records.length > 1 ? "s" : ""}.`; }
function restoredField(value, fallbackScore) { return value && typeof value === "object" && "value" in value ? { ...makeField(value.value, value.score ?? fallbackScore, value.rule || "Valeur restaurée depuis le JSON"), original: value.original ?? value.value, edited: Boolean(value.edited) } : makeField(value || "", fallbackScore, "Valeur restaurée depuis le JSON"); }
function restoredRecord(item) { const score = scoreForConfidence(item.confiance); const natureValue = item.nature?.value ?? item.nature; const nature = natures.includes(natureValue) ? natureValue : "Divers"; const legacyDate = item.date?.value ?? item.date; const legacyMonth = typeof legacyDate === "string" && /^\d{4}-\d{2}/.test(legacyDate) ? monthLabels[Number(legacyDate.slice(5, 7)) - 1] : legacyDate; return { id: crypto.randomUUID(), name: item.name || item.fichier || "Document restauré", previewUrl: null, previewType: "", rawText: item.rawText || item.texteBrut || "Texte brut non inclus dans cet export.", readingSource: item.readingSource || item.sourceLecture || "Export ScanLot", ocrScore: item.ocrScore ?? score, month: restoredField(item.month ?? legacyMonth, score), supplier: restoredField(item.supplier ?? item.fournisseur, score), nature: restoredField(nature, score), amount: restoredField(item.amount ?? item.montantTtc ?? item.montant, score), status: item.status || item.etat || "Reconnu" }; }
async function importJson(file) { try { const content = JSON.parse(await file.text()); const importedRecords = content?.format === "scanlot-work" ? content.records : content; if (!Array.isArray(importedRecords)) throw new Error("le fichier ne contient pas une sauvegarde ScanLot"); if (records.length && !confirm("Remplacer le lot actuellement affiché par ce fichier JSON ?")) return; records.splice(0, records.length, ...importedRecords.map(restoredRecord)); renderAll(); progress.textContent = `${records.length} ligne${records.length > 1 ? "s" : ""} restaurée${records.length > 1 ? "s" : ""} depuis ${file.name}.`; } catch (error) { progress.textContent = `Import JSON impossible : ${error.message}.`; } }

function updateRecord(event) { const field = event.target.dataset.field; const record = records.find(item => item.id === event.target.dataset.id); if (!record || !field) return; if (field === "status") record.status = event.target.value; else { record[field].value = event.target.value; record[field].edited = event.target.value !== record[field].original; } renderResults(); }
function download(name, type, content) { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); URL.revokeObjectURL(link.href); }
function validatedRecords() { return records.filter(record => record.status === "Reconnu"); }
function exportCsv() { const rows = validatedRecords(); const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`; const content = ["Mois;Fournisseur;Nature;Montant TTC", ...rows.map(record => [record.month.value, record.supplier.value, record.nature.value, record.amount.value].map(quote).join(";"))].join("\r\n"); download("scanlot-valide.csv", "text/csv;charset=utf-8", `\uFEFF${content}`); }
function exportJson() { const work = { format: "scanlot-work", version: 4, savedAt: new Date().toISOString(), records: records.map(record => ({ name: record.name, rawText: record.rawText, readingSource: record.readingSource, ocrScore: record.ocrScore, month: record.month, supplier: record.supplier, nature: record.nature, amount: record.amount, status: record.status })) }; download("scanlot-travail.json", "application/json", JSON.stringify(work, null, 2)); }
function showRawText(id) { const record = records.find(item => item.id === id); if (!record) return; document.querySelector("#rawTextTitle").textContent = `Texte lu — ${record.name}`; document.querySelector("#rawTextInfo").textContent = `${record.readingSource} · confiance OCR/extraction : ${record.ocrScore ?? 0} %`; document.querySelector("#rawText").value = record.rawText; rawTextDialog.showModal(); }
async function chooseSourceFolder() { if (!("showDirectoryPicker" in window)) { progress.textContent = "Cette fonction nécessite Chrome ou Edge."; return false; } try { sourceFolderHandle = await window.showDirectoryPicker({ mode: "read" }); chooseSourceFolderButton.textContent = `Dossier : ${sourceFolderHandle.name}`; progress.textContent = `Dossier des documents sélectionné : ${sourceFolderHandle.name}.`; return true; } catch (error) { if (error.name !== "AbortError") progress.textContent = "Impossible d’ouvrir ce dossier."; return false; } }
async function preparePreview(record) { if (record.previewUrl) return true; if (!sourceFolderHandle && !await chooseSourceFolder()) return false; try { const handle = await sourceFolderHandle.getFileHandle(record.name); const file = await handle.getFile(); record.previewUrl = URL.createObjectURL(file); record.previewType = file.type; return true; } catch { return false; } }
async function showPreview(id) { const record = records.find(item => item.id === id); if (!record) return; const pdf = document.querySelector("#pdfPreview"), image = document.querySelector("#imagePreview"), unavailable = document.querySelector("#previewUnavailable"); document.querySelector("#previewTitle").textContent = record.name; pdf.hidden = true; image.hidden = true; const available = await preparePreview(record); unavailable.hidden = available; if (available) { if (record.previewType === "application/pdf" || record.name.toLowerCase().endsWith(".pdf")) { pdf.src = record.previewUrl; pdf.hidden = false; } else { image.src = record.previewUrl; image.hidden = false; } } if (!previewDialog.open) previewDialog.show(); }
function showStats() { const count = field => records.filter(record => record[field].edited).length; const recognized = validatedRecords(); const untouched = recognized.filter(record => !["month", "supplier", "nature", "amount"].some(field => record[field].edited)).length; const stats = [["Documents", records.length], ["Reconnu", recognized.length], ["À vérifier", records.filter(record => record.status === "À vérifier").length], ["Saisie manuelle", records.filter(record => record.status === "Saisie manuelle").length], ["Validés sans correction", untouched], ["Mois corrigés", count("month")], ["Fournisseurs corrigés", count("supplier")], ["Natures corrigées", count("nature")], ["Montants corrigés", count("amount")]]; document.querySelector("#statsContent").innerHTML = stats.map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`).join(""); statsDialog.showModal(); }

fileInput.addEventListener("change", event => { importFiles(event.target.files); event.target.value = ""; });
chooseSourceFolderButton.addEventListener("click", chooseSourceFolder);
[
  ["dragenter", event => { event.preventDefault(); dropZone.classList.add("drag-over"); }],
  ["dragover", event => event.preventDefault()],
  ["dragleave", event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("drag-over"); }],
  ["drop", event => { event.preventDefault(); dropZone.classList.remove("drag-over"); importFiles(event.dataTransfer.files); }]
].forEach(([name, handler]) => dropZone.addEventListener(name, handler));
jsonInput.addEventListener("change", event => { if (event.target.files[0]) importJson(event.target.files[0]); event.target.value = ""; });
resultsBody.addEventListener("change", updateRecord);
resultsBody.addEventListener("click", event => { const rawTextId = event.target.dataset.rawText, previewId = event.target.dataset.preview; if (rawTextId) showRawText(rawTextId); if (previewId) showPreview(previewId); });
exportCsvButton.addEventListener("click", exportCsv); exportJsonButton.addEventListener("click", exportJson); showStatsButton.addEventListener("click", showStats);
