// File: src/app/admin/template-studio/page.tsx
// Description: Auto-added top comment for easier file identification.

'use client';

import { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import { v4 as uuid } from 'uuid';
import type { IStripElement } from '@/models/Template';
import { Search, FolderUp, Plus, Save, Image as ImageIcon, Layers, Settings2, X, Loader2 } from 'lucide-react';
import { AdminPageHeader } from '@/app/admin/components';

import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import type { EditorCanvasHandle } from './component/EditorCanvas';

const EditorCanvas = dynamic(() => import('./component/EditorCanvas'), {
  ssr: false,
  loading: () => <div className={styles.canvasLoading}><Loader2 className="spin" size={40} /></div>,
});
import ElementToolbar from './component/ElementToolbar';
import LayerPanel from './component/LayerPanel';
import PropertiesPanel from './component/PropertiesPanel';
import AssetSearch from './component/AssetSearch';
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT, CHROMA_KEY_TARGET, CHROMA_KEY_THRESHOLD } from '@/lib/utils/constants';
import { adminFetch } from '@/lib/utils/admin-fetch';
import { removeGreenScreen } from '@/lib/utils/canvas-utils';
import styles from './page.module.css';

const DEFAULT_CANVAS_W = DEFAULT_CANVAS_WIDTH;
const DEFAULT_CANVAS_H = DEFAULT_CANVAS_HEIGHT;

function makeId(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}_${uuid().slice(0, 6)}`;
}

interface ISlot {
  x: number; y: number; w: number; h: number;
}

function detectTransparentSlots(imgEl: HTMLImageElement, cw = DEFAULT_CANVAS_W, ch = DEFAULT_CANVAS_H): ISlot[] {
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(imgEl, 0, 0, cw, ch);
  let imgData;
  try { imgData = ctx.getImageData(0, 0, cw, ch); } catch { return []; }
  const data = imgData.data;
  const grid: boolean[] = new Array(cw * ch);
  const [targetR, targetG, targetB] = CHROMA_KEY_TARGET;
  const threshold2 = CHROMA_KEY_THRESHOLD;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    const dr = data[i] - targetR, dg = data[i + 1] - targetG, db = data[i + 2] - targetB;
    grid[i / 4] = a < 50 || (dr * dr + dg * dg + db * db) < threshold2;
  }
  const visited = new Uint8Array(cw * ch);
  const rects: ISlot[] = [];
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const idx = y * cw + x;
      if (!grid[idx] || visited[idx]) continue;
      let minX = x, maxX = x, minY = y, maxY = y;
      const queue: [number, number][] = [[x, y]];
      visited[idx] = 1;
      while (queue.length) {
        const [cx, cy] = queue.shift()!;
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        for (const [nx, ny] of [[cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]]) {
          if (nx >= 0 && nx < cw && ny >= 0 && ny < ch) {
            const nidx = ny * cw + nx;
            if (grid[nidx] && !visited[nidx]) { visited[nidx] = 1; queue.push([nx, ny]); }
          }
        }
      }
      const rw = maxX - minX + 1, rh = maxY - minY + 1;
      const minSlotPx = 100;
      if (rw >= minSlotPx && rh >= minSlotPx) {
        const padX = Math.max(cw * 0.05, 16);
        const padY = Math.max(ch * 0, 16);
        const px = Math.max(0, minX - padX);
        const py = Math.max(0, minY - padY);
        rects.push({
          x: Math.round((px / cw) * 100 * 10) / 10,
          y: Math.round((py / ch) * 100 * 10) / 10,
          w: Math.round((Math.min(cw - px, rw + padX * 2) / cw) * 100 * 10) / 10,
          h: Math.round((Math.min(ch - py, rh + padY * 2) / ch) * 100 * 10) / 10,
        });
      }
    }
  }
  return rects.sort((a, b) => Math.abs(a.y - b.y) < 3 ? a.x - b.x : a.y - b.y);
}

function generateSlotLayout(slotCount: number): IStripElement[] {
  const marginX = Math.round(DEFAULT_CANVAS_W * 0.055);
  const photoW = DEFAULT_CANVAS_W - marginX * 2;
  const gap = 28;
  const topPad = 40;
  const bottomPad = 320;
  const availH = DEFAULT_CANVAS_H - topPad - bottomPad;
  const photoH = Math.round((availH - (slotCount - 1) * gap) / slotCount);
  const elements: IStripElement[] = [];

  for (let i = 0; i < slotCount; i++) {
    const id = `slot-${i}`;
    elements.push({
      id, type: 'photo-slot',
      x: marginX, y: Math.round(topPad + i * (photoH + gap)),
      width: photoW, height: photoH,
      rotation: 0, zIndex: i, visible: true,
      props: { shape: 'rounded', borderWidth: 2, borderColor: '#ffffff', borderRadius: 8 },
    });
  }

  elements.push({
    id: 'text-velvet',
    type: 'text',
    x: DEFAULT_CANVAS_W - 200,
    y: DEFAULT_CANVAS_H - 36,
    width: 180,
    height: 24,
    rotation: 0,
    zIndex: slotCount,
    visible: true,
    props: {
      content: 'by VelvetSnap',
      fontSize: 16,
      fontFamily: 'Inter',
      color: '#3d2c2c',
      fontWeight: '300',
      textAlign: 'right',
    },
  });

  return elements;
}

export default function StripsStudioPageWrapper() {
  return (
    <Suspense fallback={
      <div className={styles.page}>
        <AdminPageHeader title="Strips Studio" subtitle="Loading..." />
        <div className={`flex-center ${styles.fallbackLoader}`}>
          <Loader2 className="spin" size={32} />
        </div>
      </div>
    }>
      <StripsStudioPage />
    </Suspense>
  );
}

function StripsStudioPage() {
  const searchParams = useSearchParams();
  const editIdParam = searchParams.get('edit');
  const [slotCount, setSlotCount] = useState(3);
  const [elements, setElements] = useState<IStripElement[]>(() => generateSlotLayout(3));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: DEFAULT_CANVAS_W, h: DEFAULT_CANVAS_H });
  const [canvasBg, setCanvasBg] = useState('#ffffff');
  const router = useRouter();
  const [importProcessing, setImportProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDesc, setTemplateDesc] = useState('Designed in Strips Studio');
  const [templatePrice, setTemplatePrice] = useState(0);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [templateIdField, setTemplateIdField] = useState('');
  const [templateFolderId, setTemplateFolderId] = useState<string | null>(null);

  const editorRef = useRef<EditorCanvasHandle>(null);
  const stickerTargetRef = useRef<string | null>(null);
  const bgTargetRef = useRef(false);
  const [stickerTargetId, setStickerTargetId] = useState<string | null>(null);
  const [activeMobilePanel, setActiveMobilePanel] = useState<'elements' | 'background' | 'layers' | 'properties' | null>(null);

  const resetEditor = useCallback(() => {
    setEditingTemplateId(null);
    setTemplateFolderId(null);
    setTemplateName('');
    setTemplateDesc('Designed in Strips Studio');
    setTemplatePrice(0);
    setElements(generateSlotLayout(3));
    setSlotCount(3);
    setSelectedId(null);
    setCanvasSize({ w: DEFAULT_CANVAS_W, h: DEFAULT_CANVAS_H });
    setCanvasBg('#ffffff');
  }, []);

  useEffect(() => {
    setPageLoading(true);

    if (!editIdParam) {
      resetEditor();
      setTemplateIdField(makeId());
      setPageLoading(false);
      return;
    }

    adminFetch(`/api/templates/thumbnails?id=${editIdParam}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success && res.data?.length) {
          const data = res.data[0];
          setEditingTemplateId(data._id || editIdParam);
          setTemplateFolderId(data.templateId || null);
          setTemplateIdField(data.templateId || data._id || makeId());
          setTemplateName(data.templateName || data.name || '');
          if (typeof data.templatePrice === 'number') setTemplatePrice(data.templatePrice);
          if (data.templateData?.color || data.color) setCanvasBg(data.templateData?.color || data.color);
          const cw = data.templateData?.canvasWidth || data.canvasWidth || 600;
          const ch = data.templateData?.canvasHeight || data.canvasHeight || 900;
          setCanvasSize({ w: cw, h: ch });
          const elementsData = data.templateData?.elements || data.elements;
          if (elementsData?.length) {
            setElements(elementsData);
            const slotEls = elementsData.filter((el: IStripElement) => el.id?.startsWith('slot-'));
            if (slotEls?.length) setSlotCount(slotEls.length);
          } else if ((data.templateFull || data.fullresUrl) && (data.templateData?.slotsLayout || data.slotsLayout)?.length) {
            const legacyUrl = data.templateFull || data.fullresUrl;
            const legacySlots = data.templateData?.slotsLayout || data.slotsLayout;
            const bgEl: IStripElement = {
              id: uuid(), type: 'background', x: 0, y: 0,
              width: cw, height: ch, rotation: 0, zIndex: 0,
              visible: true, props: { stickerUrl: legacyUrl },
            };
            const photoSlots: IStripElement[] = legacySlots.map((s: { x: number; y: number; w: number; h: number }, i: number) => ({
              id: 'slot-' + uuid(), type: 'photo-slot' as const,
              x: (s.x / 100) * cw, y: (s.y / 100) * ch,
              width: (s.w / 100) * cw, height: (s.h / 100) * ch,
              rotation: 0, zIndex: i + 1, visible: true, props: {},
            }));
            setElements([bgEl, ...photoSlots, ...generateSlotLayout(0)]);
            setSlotCount(photoSlots.length);
          }
        } else {
          setTemplateIdField(makeId());
        }
        setPageLoading(false);
      })
      .catch(() => setPageLoading(false));
  }, [editIdParam, resetEditor]);

  const selected = elements.find((el) => el.id === selectedId) || null;

  const setSlotLayout = useCallback((n: number) => {
    setSlotCount(n);
    const newSlots = generateSlotLayout(n);
    setElements((prev) => [
      ...newSlots,
      ...prev.filter((el) => !el.id.startsWith('slot-') && el.id !== 'text-velvet'),
    ]);
  }, []);

  const addElement = useCallback((type: IStripElement['type']) => {
    if (type === 'sticker') {
      stickerTargetRef.current = '__new__';
      setStickerTargetId('__new__');
      return;
    }
    const id = uuid();
    const base: IStripElement = {
      id,
      type,
      x: 20,
      y: 20,
      width: type === 'photo-slot' ? 120 : type === 'shape' ? 100 : 150,
      height: type === 'photo-slot' ? 160 : type === 'shape' ? 100 : 40,
      rotation: 0,
      zIndex: elements.length,
      visible: true,
      props: {},
    };
    if (type === 'photo-slot') {
      base.props = { shape: 'rounded', borderWidth: 2, borderColor: '#ffffff', borderRadius: 8 };
    } else if (type === 'text') {
      base.props = { content: 'Type here', fontSize: 48, fontFamily: 'Inter', color: '#3d2c2c', fontWeight: '700', textAlign: 'center' };
    } else if (type === 'shape') {
      base.props = { shapeType: 'rect', fillColor: '#C5D89D', strokeColor: '#9CAB84', strokeWidth: 2, opacity: 1 };
    }
    setElements((prev) => [...prev, base]);
    setSelectedId(id);
  }, [elements.length]);

  const blobToBase64 = async (url: string): Promise<string> => {
    if (url.startsWith('data:')) return url;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch { return url; }
  };

  const handleNewTemplate = () => {
    setShowNewConfirm(false);
    const newId = makeId();
    setElements(generateSlotLayout(3));
    setSlotCount(3);
    setSelectedId(null);
    setTemplateName('');
    setTemplateDesc('Designed in Strips Studio');
    setTemplatePrice(35000);
    setEditingTemplateId(null);
    setTemplateFolderId(null);
    setTemplateIdField(newId);
    setCanvasSize({ w: DEFAULT_CANVAS_W, h: DEFAULT_CANVAS_H });
    setCanvasBg('#ffffff');
  };

  const uploadBase64Client = async (dataUri: string, folder: string, publicId?: string): Promise<string> => {
    const body: Record<string, unknown> = { dataUri, folder };
    if (publicId) body.publicId = publicId;
    const res = await adminFetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Upload failed');
    return data.url;
  };

  const handleSave = async () => {
    if (!templateName.trim()) return;
    setSaving(true);
    setSelectedId(null);
    try {
      // Determine folder — reuse templateId from doc for updates, use displayed ID for create
      const isNew = !editingTemplateId;
      const folderId = isNew ? (templateIdField || makeId()) : (templateFolderId || editingTemplateId);
      setTemplateIdField(folderId);
      const baseFolder = `velvetsnap/templates/${folderId}`;

      const rawFrame = editorRef.current?.getFrameImage() || '';
      if (!rawFrame) { alert('Failed to capture frame'); setSaving(false); return; }
      // Derive thumbnail from frame (resize)
      const thumbnailB64 = await (async () => {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new window.Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = rawFrame;
        });
        const c = document.createElement('canvas');
        const scale = 300 / (img.naturalWidth || img.width);
        c.width = 300;
        c.height = Math.round((img.naturalHeight || img.height) * scale);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/png');
      })();
      const toUpload: { key: string; b64: string; folder: string; publicId: string }[] = [];
      if (rawFrame) toUpload.push({ key: 'templateFull', b64: rawFrame, folder: baseFolder, publicId: 'templateFull' });
      if (thumbnailB64) toUpload.push({ key: 'templateThumb', b64: thumbnailB64, folder: baseFolder, publicId: 'templateThumb' });

      const savedElements = await Promise.all(elements.map(async (el) => {
        const copy = { ...el, props: { ...el.props } };
        const url = copy.props.stickerUrl;
        if (url && (url.startsWith('blob:') || url.startsWith('data:image/'))) {
          const b64 = url.startsWith('data:') ? url : await blobToBase64(url);
          const key = 'el_' + el.id;
          toUpload.push({ key, b64, folder: baseFolder, publicId: key });
        }
        return copy;
      }));

      // Upload all images to Cloudinary first
      const uploaded = await Promise.all(toUpload.map(async (item) => {
        const url = await uploadBase64Client(item.b64, item.folder, item.publicId);
        return { key: item.key, url };
      }));

      let templateFull = '';
      let templateThumb = '';
      const stickerUrls: Record<string, string> = {};
      for (const u of uploaded) {
        if (u.key === 'templateFull') templateFull = u.url;
        else if (u.key === 'templateThumb') templateThumb = u.url;
        else if (u.key.startsWith('el_')) stickerUrls[u.key.slice(3)] = u.url;
      }
      // Apply uploaded sticker URLs to elements
      for (const el of savedElements) {
        if (stickerUrls[el.id]) el.props.stickerUrl = stickerUrls[el.id];
      }

      const photoSlots = elements.filter((el) => el.type === 'photo-slot').sort((a, b) => a.zIndex - b.zIndex);
      const slotsLayout = photoSlots.map((el) => ({
        x: Math.round((el.x / canvasSize.w) * 1000) / 10,
        y: Math.round((el.y / canvasSize.h) * 1000) / 10,
        w: Math.round((el.width / canvasSize.w) * 1000) / 10,
        h: Math.round((el.height / canvasSize.h) * 1000) / 10,
      }));
      const body: Record<string, unknown> = {
        templateName: templateName,
        templateDesc: templateDesc || 'Designed in Strips Studio',
        templatePrice: templatePrice,
        templateFull,
        templateThumb,
        templateData: {
          elements: savedElements,
          slotsLayout,
          canvasWidth: canvasSize.w,
          canvasHeight: canvasSize.h,
          color: canvasBg,
          type: 'strip',
          slots: slotsLayout.length,
        },
        isActive: true,
      };
      let res;
      if (editingTemplateId) {
        res = await adminFetch(`/api/templates/${editingTemplateId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        body.templateId = folderId;
        res = await adminFetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      const data = await res.json();
      if (data.success) {
        setShowSaveModal(false);
        router.push('/admin/templates');
      } else {
        alert('Save failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Save failed: ' + String(err));
    } finally {
      setSaving(false);
    }
  };

  const openStickerGallery = (elementId: string) => {
    stickerTargetRef.current = elementId;
    setStickerTargetId(elementId);
  };

  const openBgSearch = () => {
    bgTargetRef.current = true;
    setStickerTargetId('__bg__');
  };

  const handleAssetSelect = (url: string) => {
    if (bgTargetRef.current) {
      bgTargetRef.current = false;
      const id = 'bg-image';
      const imgEl = document.createElement('img');
      imgEl.onload = () => {
        const iw = imgEl.naturalWidth;
        const ih = imgEl.naturalHeight;
        const scale = Math.max(canvasSize.w / iw, canvasSize.h / ih);
        const dw = Math.round(iw * scale);
        const dh = Math.round(ih * scale);
        const cx = Math.round((canvasSize.w - dw) / 2);
        const cy = Math.round((canvasSize.h - dh) / 2);
        const existing = elements.find((el) => el.id === id);
        if (existing) {
          setElements((prev) =>
            prev.map((el) =>
              el.id === id ? {
                ...el,
                zIndex: -1,
                width: dw, height: dh,
                x: cx, y: cy,
                props: { ...el.props, stickerUrl: url, searchBg: true },
              } : el
            )
          );
        } else {
          setElements((prev) => [...prev, {
            id, type: 'background',
            x: cx, y: cy,
            width: dw, height: dh,
            rotation: 0,
            zIndex: -1,
            visible: true,
            props: { stickerUrl: url, opacity: 1, searchBg: true },
          }]);
        }
        stickerTargetRef.current = null;
        setStickerTargetId(null);
      };
      imgEl.src = url;
      return;
    }
    const target = stickerTargetRef.current;
    if (!target) return;
    if (target === '__new__') {
      const id = uuid();
      setElements((prev) => [...prev, {
        id,
        type: 'sticker',
        x: 20, y: 20,
        width: 150, height: 150,
        rotation: 0,
        zIndex: prev.length,
        visible: true,
        props: { stickerUrl: url, opacity: 1 },
      }]);
      setSelectedId(id);
    } else {
      setElements((prev) =>
        prev.map((el) =>
          el.id === target ? { ...el, props: { ...el.props, stickerUrl: url } } : el
        )
      );
    }
    stickerTargetRef.current = null;
    setStickerTargetId(null);
  };

  const updateElement = (id: string, patch: Partial<IStripElement>) => {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  };

  const updateElementProps = (id: string, props: Record<string, unknown>) => {
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, props: { ...el.props, ...props } } : el))
    );
  };

  const deleteElement = (id: string) => {
    setElements((prev) => prev.filter((el) => el.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const toggleVisibility = (id: string) => {
    setElements((prev) => prev.map((el) => el.id === id ? { ...el, visible: !el.visible } : el));
  };

  const bringForward = (id: string) => {
    setElements((prev) => {
      const idx = prev.findIndex((el) => el.id === id);
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      const temp = next[idx].zIndex;
      next[idx] = { ...next[idx], zIndex: next[idx + 1].zIndex };
      next[idx + 1] = { ...next[idx + 1], zIndex: temp };
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const sendBackward = (id: string) => {
    setElements((prev) => {
      const idx = prev.findIndex((el) => el.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      const temp = next[idx].zIndex;
      next[idx] = { ...next[idx], zIndex: next[idx - 1].zIndex };
      next[idx - 1] = { ...next[idx - 1], zIndex: temp };
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const renderBackgroundSection = () => (
      <aside className={styles.asideCard}>
        <h3 className="section-heading">Background</h3>
        <div className={styles.bgPreview}>
          {(() => {
            const bg = elements.find((el) => el.id === 'bg-image');
            const url = bg?.props?.stickerUrl;
            return url ? (
              <Image src={url} alt="Background" fill sizes="300px" />
            ) : (
              <span className="text-muted-sm">No background</span>
            );
          })()}
        </div>
        <div className="flex-row flex-row-sm">
          <button
            onClick={openBgSearch}
            disabled={pageLoading}
            className={styles.bgBtn}
          >
            <Search size={16} /> Search
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importProcessing || pageLoading}
            className={styles.bgBtn}
          >
            {importProcessing ? <Loader2 className="spin" size={16} /> : <FolderUp size={16} />} Import
          </button>
        </div>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setImportProcessing(true);
          try {
            const reader = new FileReader();
            reader.onloadend = async () => {
              const dataUrl = reader.result as string;
              const processed = await removeGreenScreen(dataUrl, DEFAULT_CANVAS_W);
              const img = new window.Image();
              img.onload = () => {
                const cw = DEFAULT_CANVAS_W, ch = DEFAULT_CANVAS_H;
                const detected = detectTransparentSlots(img, cw, ch);
                if (detected.length === 0) { setImportProcessing(false); return; }
                const slotEls: IStripElement[] = detected.map((s, i) => ({
                  id: `slot-${i}`,
                  type: 'photo-slot',
                  x: Math.round((s.x / 100) * cw),
                  y: Math.round((s.y / 100) * ch),
                  width: Math.round((s.w / 100) * cw),
                  height: Math.round((s.h / 100) * ch),
                  rotation: 0, zIndex: i, visible: true,
                  props: { shape: 'rounded', borderWidth: 2, borderColor: '#ffffff', borderRadius: 8 },
                }));
                setElements((prev) => [
                  ...slotEls,
                  ...prev.filter((el) => el.id.startsWith('text-') || el.id === 'bg-image').map((el) =>
                    el.id === 'bg-image'
                      ? { ...el, x: 0, y: 0, width: cw, height: ch, zIndex: detected.length, props: { ...el.props, stickerUrl: processed } }
                      : el
                  ),
                ]);
                setSlotCount(detected.length);
                const hasBg = elements.some((el) => el.id === 'bg-image');
                if (!hasBg) {
                  setElements((prev) => [...prev, {
                    id: 'bg-image', type: 'background',
                    x: 0, y: 0,
                    width: cw, height: ch,
                    rotation: 0, zIndex: detected.length, visible: true,
                    props: { stickerUrl: processed, opacity: 1 },
                  }]);
                }
                setImportProcessing(false);
              };
              img.src = processed;
            };
            reader.readAsDataURL(file);
          } catch (e) { console.error('import processing failed', e); setImportProcessing(false); }
        }}
      />
    </aside>
  );

  const renderMobilePanel = () => {
    if (!activeMobilePanel) return null;

    const titles: Record<string, string> = {
      elements: 'Elements',
      background: 'Background',
      layers: 'Layers',
      properties: 'Properties',
    };

    let content: React.ReactNode = null;
    switch (activeMobilePanel) {
      case 'elements':
        content = <ElementToolbar onAdd={addElement} />;
        break;
      case 'background':
        content = renderBackgroundSection();
        break;
      case 'layers':
        content = (
          <LayerPanel
            elements={elements}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggleVisibility={toggleVisibility}
            onBringForward={bringForward}
            onSendBackward={sendBackward}
            onDelete={deleteElement}
          />
        );
        break;
      case 'properties':
        content = selected ? (
          <PropertiesPanel
            selected={selected}
            slotCount={slotCount}
            onSetSlotCount={setSlotLayout}
            onUpdateProps={(props) => selected && updateElementProps(selected.id, props)}
            onUpdate={(patch) => selected && updateElement(selected.id, patch)}
            onDelete={() => selected && deleteElement(selected.id)}
            onBringForward={() => selected && bringForward(selected.id)}
            onSendBackward={() => selected && sendBackward(selected.id)}
            onBrowseStickers={() => selected && openStickerGallery(selected.id)}
            disabled={pageLoading}
          />
        ) : (
          <p className={styles.emptyState}>
            Select an element to edit
          </p>
        );
        break;
    }

    return (
      <div className={styles.mobileOverlay} onClick={() => setActiveMobilePanel(null)}>
        <div className={styles.mobilePanel} onClick={(e) => e.stopPropagation()}>
          <div className={styles.mobilePanelHeader}>
            <h3>{titles[activeMobilePanel]}</h3>
            <button onClick={() => setActiveMobilePanel(null)}><X size={18} /></button>
          </div>
          <div className={styles.mobilePanelBody}>
            {content}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <AdminPageHeader
        title="Strips Studio"
        subtitle="Design your strip template — drag, drop, style"
      />

      <div className={styles.editorLayout}>
        <div className={styles.leftSidebar}>
          <aside className={styles.asideCard}>
            <button
              onClick={() => setShowNewConfirm(true)}
              disabled={pageLoading}
              className={styles.toolBtnGhost}
            >
              <Plus size={18} /> New Template
            </button>
            <button
              onClick={() => setShowSaveModal(true)}
              disabled={pageLoading}
              className={styles.toolBtnPrimary}
            >
              <Save size={18} /> Save Template
            </button>
          </aside>

          <ElementToolbar onAdd={addElement} disabled={pageLoading} />

          {renderBackgroundSection()}

          <LayerPanel
            elements={elements}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggleVisibility={toggleVisibility}
            onBringForward={bringForward}
            onSendBackward={sendBackward}
            onDelete={deleteElement}
            disabled={pageLoading}
          />
        </div>

        <div className={styles.canvasArea}>
          {pageLoading && (
            <div className={styles.loadingOverlay}>
              <Loader2 className="spin" size={36} />
            </div>
          )}
          <EditorCanvas
            ref={editorRef}
            elements={elements}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onUpdate={updateElement}
            canvasSize={canvasSize}
            canvasBg={canvasBg}
          />
        </div>

        <div className={styles.rightSidebar}>
          <PropertiesPanel
            selected={selected}
            slotCount={slotCount}
            onSetSlotCount={setSlotLayout}
            onUpdateProps={(props) => selected && updateElementProps(selected.id, props)}
            onUpdate={(patch) => selected && updateElement(selected.id, patch)}
            onDelete={() => selected && deleteElement(selected.id)}
            onBringForward={() => selected && bringForward(selected.id)}
            onSendBackward={() => selected && sendBackward(selected.id)}
            onBrowseStickers={() => selected && openStickerGallery(selected.id)}
            disabled={pageLoading}
          />
        </div>
      </div>

      <div className={styles.mobileToolbar}>
        <button
          onClick={() => setActiveMobilePanel(activeMobilePanel === 'elements' ? null : 'elements')}
          disabled={pageLoading}
          style={{ opacity: pageLoading ? 0.4 : 1 }}
        >
          <span>📦</span> Elements
        </button>
        <button
          onClick={() => setActiveMobilePanel(activeMobilePanel === 'background' ? null : 'background')}
          disabled={pageLoading}
          style={{ opacity: pageLoading ? 0.4 : 1 }}
        >
          <ImageIcon size={18} /> Bg
        </button>
        <button
          onClick={() => setActiveMobilePanel(activeMobilePanel === 'layers' ? null : 'layers')}
          disabled={pageLoading}
          style={{ opacity: pageLoading ? 0.4 : 1 }}
        >
          <Layers size={18} /> Layers
        </button>
        <button
          onClick={() => setActiveMobilePanel(activeMobilePanel === 'properties' ? null : 'properties')}
          disabled={pageLoading}
          style={{ opacity: pageLoading ? 0.4 : 1 }}
        >
          <Settings2 size={18} /> Props
        </button>
        <div className={styles.mobileToolbarDivider} />
        <button
          onClick={() => setShowNewConfirm(true)}
          disabled={pageLoading}
          style={{ opacity: pageLoading ? 0.4 : 1 }}
        >
          <Plus size={18} /> New
        </button>
        <button
          onClick={() => setShowSaveModal(true)}
          disabled={pageLoading}
          style={{ opacity: pageLoading ? 0.4 : 1 }}
        >
          <Save size={18} /> Save
        </button>
      </div>

      {renderMobilePanel()}

      {stickerTargetId && (
        <AssetSearch
          onSelect={handleAssetSelect}
          onClose={() => setStickerTargetId(null)}
          isBackground={stickerTargetId === '__bg__'}
        />
      )}

      {showNewConfirm && (
        <div className={styles.modalOverlay} onClick={() => setShowNewConfirm(false)}>
          <div className={styles.modalDialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>New Template</h3>
            <p className={styles.modalText}>All current work will be cleared. Continue?</p>
            <div className={styles.modalActions}>
              <button onClick={() => setShowNewConfirm(false)} className={styles.modalBtn}>Cancel</button>
              <button onClick={handleNewTemplate} className={styles.modalBtnDanger}>Clear & Start New</button>
            </div>
          </div>
        </div>
      )}

      {showSaveModal && (
        <div className={styles.modalOverlay} onClick={() => !saving && setShowSaveModal(false)}>
          <div className={`${styles.modalDialog} ${styles.modalWide}`} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.modalTitle}>{editingTemplateId ? 'Update Template' : 'Save Template'}</h3>
            <p className={styles.modalText}>{editingTemplateId ? 'Update your strip template' : 'Enter details for your strip template'}</p>
            <input
              type="text" placeholder="Template name"
              value={templateName} onChange={(e) => setTemplateName(e.target.value)} autoFocus
              className={`${styles.modalInput} ${styles.modalInputBig}`}
            />
            <input
              type="text" placeholder="Template ID (auto)"
              value={templateIdField} readOnly
              className={styles.modalInput}
            />
            <input
              type="text" placeholder="Description"
              value={templateDesc} onChange={(e) => setTemplateDesc(e.target.value)}
              className={styles.modalInput}
            />
            <input
              type="number" placeholder="Price"
              value={templatePrice} onChange={(e) => setTemplatePrice(Number(e.target.value))}
              className={`${styles.modalInput} ${styles.modalInputMb20}`}
            />
            <div className={styles.modalActions}>
              <button onClick={() => setShowSaveModal(false)} disabled={saving} className={styles.modalBtn}>Cancel</button>
              <button onClick={handleSave} disabled={saving || !templateName.trim()} className={styles.modalBtnSave}>
                {saving ? 'Saving...' : editingTemplateId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
