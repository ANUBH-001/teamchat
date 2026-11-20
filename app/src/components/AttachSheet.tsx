// Round 4 Phase 3: the paperclip sheet: Gallery (multi-select up to 10), Camera, Geo Camera.
import React from 'react';
import * as ImagePicker from 'expo-image-picker';
import Sheet, { SheetRow } from './Sheet';
import { pickPhoto, saveToGallery } from '../media';
import { getPrefs } from '../prefs';

export default function AttachSheet({ visible, onClose, onPicked, onGeo }: {
  visible: boolean; onClose: () => void; onPicked: (uris: string[]) => void; onGeo: () => void;
}) {
  // the sheet fades out first; the system picker opens a moment later (Android drops stacked Modals)
  const later = (fn: () => void) => { onClose(); setTimeout(fn, 300); };
  const gallery = () => later(async () => {
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 0.8 });
      if (!r.canceled && r.assets?.length) onPicked(r.assets.slice(0, 10).map((a) => a.uri));
    } catch (e) {}
  });
  const camera = () => later(async () => {
    const uri = await pickPhoto('camera');
    if (!uri) return;
    if (getPrefs().saveToGallery) saveToGallery(uri);
    onPicked([uri]);
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Attach">
      <SheetRow icon="images-outline" label="Gallery" onPress={gallery} />
      <SheetRow icon="camera-outline" label="Camera" onPress={camera} />
      <SheetRow icon="location-outline" label="Geo Camera (location stamp)" onPress={() => later(onGeo)} />
    </Sheet>
  );
}
