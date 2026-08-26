// File: src/lib/utils/normalize-template.ts
// Description: Auto-added top comment for easier file identification.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeTemplate(doc: any) {
  if (!doc) return doc;
  const td = doc.templateData || {};
  return {
    _id: doc._id || doc.id,
    templateId: doc.templateId,
    templateName: doc.templateName || doc.name || '',
    templateDesc: doc.templateDesc || doc.description || '',
    templatePrice: doc.templatePrice ?? doc.price ?? 0,
    templateFull: doc.templateFull || doc.fullresUrl || doc.frameImage || '',
    templateThumb: doc.templateThumb || doc.thumbUrl || doc.thumbnail || '',
    templateData: {
      elements: td.elements || doc.elements || [],
      slotsLayout: td.slotsLayout || doc.slotsLayout || [],
      canvasWidth: td.canvasWidth || doc.canvasWidth || 1000,
      canvasHeight: td.canvasHeight || doc.canvasHeight || 3000,
      color: td.color || doc.color || '#ffffff',
      type: td.type || doc.type || 'frame',
      slots: td.slots ?? doc.slots ?? 1,
    },
    isActive: doc.isActive ?? true,
    accountId: doc.accountId || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
