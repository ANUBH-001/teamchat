// Round 4 Phase 3: Geo Camera. Live camera + live location stamp (map thumb, address, lat/lng, date-time, user name).
// Capture -> the photo + stamp are rendered in a View and burned into one JPEG with react-native-view-shot -> preview + caption -> send.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Image, Modal, Pressable, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../useTheme';
import { useAuth } from '../auth';
import { Msg } from '../chatTypes';
import { saveToGallery, sendImageToChat, useMediaSrc } from '../media';
import { getPrefs } from '../prefs';
import PhotoPreviewPanel, { PreviewItem } from '../components/PhotoPreviewPanel';

type Geo = { lat: number; lng: number; address: string };
type Loc = 'loading' | 'ok' | 'denied' | 'error';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SW = Dimensions.get('window').width;

export function stampTime(d: Date) {
  const h = d.getHours();
  return String(d.getDate()).padStart(2, '0') + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ', '
    + String(h % 12 || 12).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM');
}

// Map thumbnail with a red pin at its center (the server image may be an OSM tile that is not centered on the point).
function MapThumb({ geo, size, onDone }: { geo: Geo; size: number; onDone?: () => void }) {
  const src = useMediaSrc('/media/staticmap?lat=' + geo.lat + '&lng=' + geo.lng + '&z=16');
  return (
    <View style={{ width: size, height: size, borderRadius: 6, overflow: 'hidden', backgroundColor: '#3a3a4a', alignItems: 'center', justifyContent: 'center' }}>
      {!!src && <Image source={{ uri: src }} style={{ width: size, height: size }} onLoad={onDone} onError={onDone} />}
      <View style={{ position: 'absolute' }}><Ionicons name="location-sharp" size={size * 0.34} color="#E5242B" style={{ marginBottom: size * 0.17 }} /></View>
    </View>
  );
}

// The stamp itself (live preview and burned into the photo).
export function Stamp({ geo, when, name, onMapDone }: { geo: Geo | null; when: Date; name: string; onMapDone?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.58)', borderRadius: 8, padding: 6 }}>
      {geo && <MapThumb geo={geo} size={86} onDone={onMapDone} />}
      <View style={{ flex: 1, marginLeft: geo ? 8 : 0, justifyContent: 'center' }}>
        <Text numberOfLines={3} style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{geo ? (geo.address || 'Address nahi mila') : 'Location nahi mili'}</Text>
        {geo && <Text style={{ color: '#fff', fontSize: 11, marginTop: 1 }}>{geo.lat.toFixed(5) + ', ' + geo.lng.toFixed(5)}</Text>}
        <Text style={{ color: '#fff', fontSize: 11 }}>{stampTime(when)}</Text>
        <Text numberOfLines={1} style={{ color: '#fff', fontSize: 11, opacity: 0.85 }}>{name}</Text>
      </View>
    </View>
  );
}

export default function GeoCameraScreen({ visible, chatId, onClose, onSent }: {
  visible: boolean; chatId: number; onClose: () => void; onSent: (m: Msg) => void;
}) {
  const t = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [perm, askPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [loc, setLoc] = useState<Loc>('loading');
  const [geo, setGeo] = useState<Geo | null>(null);
  const [now, setNow] = useState(new Date());
  const [phase, setPhase] = useState<'cam' | 'compose' | 'preview'>('cam');
  const [shot, setShot] = useState<{ uri: string; w: number; h: number; at: Date } | null>(null);
  const [composed, setComposed] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [sending, setSending] = useState(false);
  const photoOk = useRef(false);
  const mapOk = useRef(false);
  const composeRef = useRef<View>(null);
  const captured = useRef(false);

  // location + address (free Android Geocoder), refreshed each time the camera opens
  useEffect(() => {
    if (!visible) return;
    let live = true;
    setPhase('cam'); setShot(null); setComposed(null); setSending(false); setLoc('loading'); setGeo(null);
    (async () => {
      try {
        const p = await Location.requestForegroundPermissionsAsync();
        if (!p.granted) { if (live) setLoc('denied'); return; }
        let pos: Location.LocationObject | null = null;
        try { pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }); } catch (e) {}
        if (!pos) pos = await Location.getLastKnownPositionAsync();
        if (!pos) { if (live) setLoc('error'); return; }
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        if (live) { setGeo({ lat, lng, address: '' }); setLoc('ok'); }
        try {
          const a = (await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }))[0];
          if (a && live) {
            const parts = [a.name, a.street, a.district, a.city || a.subregion, a.region, a.postalCode].filter((x, i, arr) => !!x && arr.indexOf(x) === i);
            setGeo({ lat, lng, address: parts.join(', ') });
          }
        } catch (e) {}
      } catch (e) { if (live) setLoc('error'); }
    })();
    const tick = setInterval(() => setNow(new Date()), 15000);
    return () => { live = false; clearInterval(tick); };
  }, [visible]);

  const take = async () => {
    if (taking || !cam.current) return;
    setTaking(true);
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.85 });
      if (pic) {
        photoOk.current = false; mapOk.current = !geo; captured.current = false;
        setShot({ uri: pic.uri, w: pic.width, h: pic.height, at: new Date() });
        setPhase('compose');
      }
    } catch (e) {}
    setTaking(false);
  };

  // compose phase: once the photo (and the map) are drawn, burn the stamp into one JPEG
  const tryCapture = () => {
    if (captured.current || !photoOk.current || !mapOk.current) return;
    captured.current = true;
    const ratio = shot ? shot.h / shot.w : 4 / 3;
    setTimeout(async () => {
      try {
        const uri = await captureRef(composeRef, { format: 'jpg', quality: 0.85, result: 'tmpfile', width: 1080, height: Math.round(1080 * ratio) });
        setComposed(uri);
        setPhase('preview');
      } catch (e) { captured.current = false; setPhase('cam'); }
    }, 250);
  };
  // safety: the map thumbnail may never answer; capture anyway after 4 s
  useEffect(() => {
    if (phase !== 'compose') return;
    const to = setTimeout(() => { mapOk.current = true; tryCapture(); }, 4000);
    return () => clearTimeout(to);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (items: PreviewItem[]) => {
    if (!composed || sending) return;
    setSending(true);
    try {
      const extra = geo ? { kind: 'geo_image', lat: geo.lat, lng: geo.lng, address: geo.address, takenAt: (shot?.at || new Date()).toISOString() } : undefined;
      const r: any = await sendImageToChat(chatId, composed, items[0]?.caption, extra);
      if (getPrefs().saveToGallery) saveToGallery(composed);
      if (r && r.message) onSent(r.message);
      onClose();
    } catch (e: any) {
      setSending(false);
      Alert.alert('Photo nahi gayi', e?.message || 'Dobara try karo');
    }
  };

  const retake = () => { setComposed(null); setShot(null); setPhase('cam'); };
  const ratio = shot ? shot.h / shot.w : 4 / 3;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={phase === 'cam' ? onClose : retake} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {phase === 'cam' && (
          !perm ? <View style={{ flex: 1 }} /> : !perm.granted ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 16 }}>Camera ki permission chahiye</Text>
              <Pressable onPress={askPerm} style={{ backgroundColor: t.accent, borderRadius: 22, paddingHorizontal: 22, height: 44, justifyContent: 'center' }}>
                <Text style={{ color: t.onAccent, fontWeight: '700' }}>Allow camera</Text>
              </Pressable>
              <Pressable onPress={onClose} style={{ marginTop: 16 }}><Text style={{ color: '#fff' }}>Back</Text></Pressable>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <CameraView ref={cam} style={{ flex: 1 }} facing={facing} flash={flash} />
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 6, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' }}>
                <Pressable onPress={onClose} hitSlop={10} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="close" size={28} color="#fff" />
                </Pressable>
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => setFlash(flash === 'off' ? 'on' : 'off')} hitSlop={10} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={flash === 'on' ? 'flash' : 'flash-off'} size={24} color="#fff" />
                </Pressable>
                <Pressable onPress={() => setFacing(facing === 'back' ? 'front' : 'back')} hitSlop={10} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="camera-reverse-outline" size={26} color="#fff" />
                </Pressable>
              </View>
              <View style={{ position: 'absolute', left: 8, right: 8, bottom: insets.bottom + 100 }}>
                {loc === 'loading' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.58)', borderRadius: 8, padding: 10 }}>
                    <ActivityIndicator color="#fff" />
                    <Text style={{ color: '#fff', marginLeft: 10, fontSize: 13 }}>Location dhoond rahe hain…</Text>
                  </View>
                ) : (
                  <Stamp geo={geo} when={now} name={user?.name || ''} />
                )}
                {loc === 'denied' && <Text style={{ color: '#fff', fontSize: 12, marginTop: 4 }}>Location permission nahi di: photo bina map ke jayegi</Text>}
              </View>
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 14, alignItems: 'center' }}>
                <Pressable
                  onPress={take} disabled={taking} accessibilityLabel="Capture"
                  style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: taking ? 0.5 : 1 }}
                >
                  <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: '#fff' }} />
                </Pressable>
              </View>
            </View>
          )
        )}
        {phase === 'compose' && !!shot && (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View ref={composeRef} collapsable={false} style={{ width: SW, height: SW * ratio, backgroundColor: '#000' }}>
              <Image source={{ uri: shot.uri }} style={{ width: SW, height: SW * ratio }} onLoad={() => { photoOk.current = true; tryCapture(); }} />
              <View style={{ position: 'absolute', left: 8, right: 8, bottom: 8 }}>
                <Stamp geo={geo} when={shot.at} name={user?.name || ''} onMapDone={() => { mapOk.current = true; tryCapture(); }} />
              </View>
            </View>
            <View style={{ position: 'absolute', bottom: insets.bottom + 30, flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator color="#fff" />
              <Text style={{ color: '#fff', marginLeft: 10 }}>Stamp laga rahe hain…</Text>
            </View>
          </View>
        )}
        {phase === 'preview' && !!composed && (
          <PhotoPreviewPanel uris={[composed]} onSend={send} onCancel={retake} sending={sending} cancelLabel="Retake" />
        )}
      </View>
    </Modal>
  );
}
