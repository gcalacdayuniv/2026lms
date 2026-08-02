// gas/Code.gs
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var base64Data = payload.base64;
    var filename = payload.filename || "Uploaded_File";
    var mimeType = payload.mimeType || "application/octet-stream";

    // Strip the data URL prefix if it exists (e.g., data:image/jpeg;base64,)
    var base64 = base64Data;
    if (base64Data.indexOf(",") > -1) {
      base64 = base64Data.split(",")[1];
    }

    var decoded = Utilities.base64Decode(base64);
    var blob = Utilities.newBlob(decoded, mimeType, filename);
    
    // Saves to the root of your Google Drive. You can replace this with a specific Folder ID.
    var folder = DriveApp.getRootFolder(); 
    var file = folder.createFile(blob);
    
    // Allows the frontend to load the image via URL
    file.setSharing(DriveApp.Access.ANYONE, DriveApp.Permission.VIEW);

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      fileUrl: file.getDownloadUrl(), // Standard download link
      fileId: file.getId()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
