import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

export async function saveNativeBase64File(options: {
  fileName: string;
  base64Data: string;
  mimeType: string;
  share?: boolean;
}) {
  const result = await Filesystem.writeFile({
    path: options.fileName,
    data: options.base64Data,
    directory: Directory.Documents,
    recursive: true,
  });

  if (options.share) {
    await Share.share({
      title: options.fileName,
      text: 'AMYC Financial report',
      url: result.uri,
      dialogTitle: 'Share AMYC file',
    });
  }

  return result.uri;
}

export function downloadBlobWeb(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

