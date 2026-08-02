// gas/Code.gs
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
        throw new Error("No payload received from the Cloudflare Worker.");
    }

    var payload = JSON.parse(e.postData.contents);
    var base64Data = payload.base64;
    var filename = payload.filename || "Uploaded_File";
    var mimeType = payload.mimeType || "application/octet-stream";
    var pathParts = payload.pathParts || []; 

    // Strip the data URL prefix if it exists
    var base64 = base64Data;
    if (base64Data.indexOf(",") > -1) {
      base64 = base64Data.split(",")[1];
    }

    var decoded = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(decoded, mimeType, filename);
    
    // Target the specific project root folder ID
    var currentFolder = DriveApp.getFolderById("1GcK1G9HE1NWII0XkSXLXyPWXP5Zxuv9f");
    
    // Traverse or create sub-folders based on the instruction path inside the root
    for (var i = 0; i < pathParts.length; i++) {
      var folderName = pathParts[i];
      if (!folderName) continue;
      
      var folders = currentFolder.getFoldersByName(folderName);
      if (folders.hasNext()) {
        currentFolder = folders.next();
      } else {
        currentFolder = currentFolder.createFolder(folderName);
      }
    }
    
    // Create the file. Permissions are automatically inherited from the root folder.
    var file = currentFolder.createFile(blob);

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      fileUrl: file.getDownloadUrl(),
      fileId: file.getId()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
