// gas/Code.gs
// Handles three kinds of requests from the Cloudflare Worker:
//   1. Direct upload (no "action"): whole file in one request (small files, profile pictures).
//   2. action "chunk":  stores one piece of a large upload in a temporary Drive folder.
//   3. action "finish": joins the pieces, saves the final file, deletes the temporary pieces.

var ROOT_FOLDER_ID = "1GcK1G9HE1NWII0XkSXLXyPWXP5Zxuv9f";
var TEMP_FOLDER_NAME = "_upload_tmp";
var MAX_CHUNKS = 10;                    // keep in sync with MAX_UPLOAD_CHUNKS in worker/worker.js
var MAX_CHUNK_CHARS = 5000000;          // safety cap for one piece of base64 text
var STALE_MS = 24 * 60 * 60 * 1000;     // abandoned temporary uploads are removed after 1 day
var ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("No payload received from the Cloudflare Worker.");
    }

    var payload = JSON.parse(e.postData.contents);

    if (payload.action === "chunk") return jsonOut(handleChunk(payload));
    if (payload.action === "finish") return jsonOut(handleFinish(payload));
    return jsonOut(handleDirect(payload));

  } catch (error) {
    return jsonOut({ success: false, error: error.toString() });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Removes slashes so a name can never escape its folder.
function cleanName(value, fallback) {
  var s = String(value == null ? "" : value).replace(/[\\\/]/g, "_").trim();
  return s || fallback;
}

// Finds or creates a sub-folder. The lock stops parallel requests from creating duplicates.
function getOrCreateFolder(parent, name) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var it = parent.getFoldersByName(name);
    if (it.hasNext()) return it.next();
    return parent.createFolder(name);
  } finally {
    lock.releaseLock();
  }
}

function resolveTargetFolder(pathParts) {
  var current = DriveApp.getFolderById(ROOT_FOLDER_ID);
  var parts = pathParts || [];
  for (var i = 0; i < parts.length; i++) {
    var folderName = cleanName(parts[i], "");
    if (!folderName) continue;
    current = getOrCreateFolder(current, folderName);
  }
  return current;
}

function decodeToBlob(base64Data, mimeType, filename) {
  var base64 = String(base64Data || "");
  if (base64.indexOf(",") > -1) base64 = base64.split(",")[1];
  var decoded = Utilities.base64Decode(base64);
  return Utilities.newBlob(decoded, mimeType || "application/octet-stream", filename);
}

function saveFile(folder, blob) {
  var file = folder.createFile(blob);
  return { success: true, fileUrl: file.getDownloadUrl(), fileId: file.getId() };
}

// ---- 1. Direct upload ----------------------------------------------------------
function handleDirect(payload) {
  if (!payload.base64) throw new Error("No file data received.");
  var filename = cleanName(payload.filename, "Uploaded_File");
  var blob = decodeToBlob(payload.base64, payload.mimeType, filename);
  var folder = resolveTargetFolder(payload.pathParts);
  return saveFile(folder, blob);
}

// ---- 2. One piece of a large upload ---------------------------------------------
function chunkName(index) {
  return "chunk_" + ("000" + index).slice(-3);
}

function handleChunk(payload) {
  var uploadId = String(payload.uploadId || "");
  var index = payload.index;
  var total = payload.total;
  var data = payload.data;

  if (!ID_RE.test(uploadId)) throw new Error("Invalid upload id.");
  if (typeof index !== "number" || typeof total !== "number" ||
      index % 1 !== 0 || total % 1 !== 0 ||
      total < 1 || total > MAX_CHUNKS || index < 0 || index >= total) {
    throw new Error("Invalid chunk details.");
  }
  if (typeof data !== "string" || data.length === 0 || data.length > MAX_CHUNK_CHARS) {
    throw new Error("Invalid chunk data.");
  }

  var tempRoot = getOrCreateFolder(DriveApp.getFolderById(ROOT_FOLDER_ID), TEMP_FOLDER_NAME);
  var folder = getOrCreateFolder(tempRoot, uploadId);

  // A retried piece replaces the earlier attempt.
  var name = chunkName(index);
  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);

  folder.createFile(name, data, MimeType.PLAIN_TEXT);
  return { success: true, index: index };
}

// ---- 3. Join the pieces ---------------------------------------------------------
function handleFinish(payload) {
  var uploadId = String(payload.uploadId || "");
  var total = payload.total;

  if (!ID_RE.test(uploadId)) throw new Error("Invalid upload id.");
  if (typeof total !== "number" || total % 1 !== 0 || total < 1 || total > MAX_CHUNKS) {
    throw new Error("Invalid upload details.");
  }

  var tempRoot = getOrCreateFolder(DriveApp.getFolderById(ROOT_FOLDER_ID), TEMP_FOLDER_NAME);
  var folders = tempRoot.getFoldersByName(uploadId);
  if (!folders.hasNext()) throw new Error("Upload pieces were not found. Please try again.");
  var tempFolder = folders.next();

  var parts = [];
  for (var i = 0; i < total; i++) {
    var files = tempFolder.getFilesByName(chunkName(i));
    if (!files.hasNext()) {
      throw new Error("Piece " + (i + 1) + " of " + total + " is missing. Please try again.");
    }
    parts.push(files.next().getBlob().getDataAsString());
  }

  var filename = cleanName(payload.filename, "Uploaded_File");
  var blob = decodeToBlob(parts.join(""), payload.mimeType, filename);
  parts = null;

  var folder = resolveTargetFolder(payload.pathParts);
  var result = saveFile(folder, blob);

  tempFolder.setTrashed(true);
  cleanStaleUploads(tempRoot);
  return result;
}

// Removes temporary uploads that were abandoned (for example the student closed the page).
function cleanStaleUploads(tempRoot) {
  try {
    var cutoff = new Date().getTime() - STALE_MS;
    var it = tempRoot.getFolders();
    while (it.hasNext()) {
      var f = it.next();
      if (f.getDateCreated().getTime() < cutoff) f.setTrashed(true);
    }
  } catch (err) {
    // Cleanup is best effort and must never fail an upload.
  }
}
