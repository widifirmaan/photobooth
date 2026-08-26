// File: src/app/admin/templates/page.tsx
// Description: Auto-added top comment for easier file identification.

'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Trash2, Loader2, ExternalLink, Pencil } from 'lucide-react';
import { AdminPageHeader, AdminTableCard, AdminConfirmModal, AdminModal } from '@/app/admin/components';
import { adminFetch } from '@/lib/utils/admin-fetch';
import type { IStripElement } from '@/models/Template';
import styles from './page.module.css';

interface TemplateData {
  _id: string;
  templateId: string;
  templateName: string;
  templateDesc: string;
  templatePrice: number;
  isActive: boolean;
  templateFull?: string;
  templateThumb?: string;
  templateData?: {
    canvasWidth?: number;
    canvasHeight?: number;
    elements?: IStripElement[];
    color?: string;
    slots?: number;
  };
}

export default function TemplatesAdmin() {
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TemplateData | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/api/templates/list', { cache: 'no-store' });
      const data = await res.json();
      if (data.success) setTemplates(data.data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteTarget(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await adminFetch(`/api/templates/${deleteTarget}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(res.statusText);
      setDeleteTarget(null);
      await fetchTemplates();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRenameClick = (t: TemplateData) => {
    setRenameTarget(t);
    setRenameName(t.templateName);
  };

  const handleRenameSave = async () => {
    if (!renameTarget || !renameName.trim()) return;
    setRenameLoading(true);
    try {
      const res = await adminFetch(`/api/templates/${renameTarget._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateName: renameName.trim() }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Rename failed');
      setRenameTarget(null);
      await fetchTemplates();
    } catch (err) {
      console.error('Rename failed:', err);
      alert('Rename failed: ' + String(err));
    } finally {
      setRenameLoading(false);
    }
  };

  const handleToggleActive = async (t: TemplateData) => {
    const prevActive = t.isActive;
    try {
      await adminFetch(`/api/templates/${t._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !prevActive }),
      });
      fetchTemplates();
    } catch (err) {
      console.error('Toggle failed:', err);
      setTemplates((prev) =>
        prev.map((tm) => (tm._id === t._id ? { ...tm, isActive: prevActive } : tm))
      );
    }
  };

  return (
    <div className="page-stack">
      <AdminPageHeader
        title="Templates"
        subtitle="Manage photobooth templates and frames"
      />

      <AdminTableCard>
        {loading ? (
          <div className={styles.loader}><Loader2 className="spin" size={32} /></div>
        ) : (
          <div className={styles.responsiveTable}><table className="admin-table">
            <thead>
              <tr>
                <th>Preview</th>
                <th>ID</th>
                <th>Name</th>
                <th>Slots</th>
                <th>Price</th>
                <th>Color</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t._id}>
                  <td>
                    <div className={styles.templateThumb}>
                      {t.templateThumb ? (
                        <Image src={t.templateThumb} alt={t.templateName} fill sizes="48px" />
                      ) : t.templateFull ? (
                        <Image src={t.templateFull} alt={t.templateName} fill sizes="48px" />
                      ) : (
                        <span className="text-muted-sm">—</span>
                      )}
                    </div>
                  </td>
                  <td>{t.templateId}</td>
                  <td>{t.templateName}</td>
                  <td>{t.templateData?.slots || 1}</td>
                  <td>Rp {(t.templatePrice || 0).toLocaleString('id-ID')}</td>
                  <td><span className={styles.colorSwatch} style={{ backgroundColor: t.templateData?.color || '#000000' }} /></td>
                  <td>
                    <div className={styles.statusToggle}>
                      <button className={`${styles.toggleSwitch} ${t.isActive !== false ? styles.active : styles.inactive}`} onClick={() => handleToggleActive(t)} type="button">
                        <span className={styles.toggleKnob} />
                      </button>
                      <span className={`${styles.statusLabel} ${t.isActive !== false ? styles.active : styles.inactive}`}>
                        {t.isActive !== false ? 'Active' : 'Off'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="flex-row flex-row-sm">
                      <button className="icon-btn" onClick={() => handleRenameClick(t)} title="Rename template">
                        <Pencil size={16} />
                      </button>
                      <a href={`/admin/template-studio?edit=${t._id}`} className="icon-btn" title="Edit in Strips Studio">
                        <ExternalLink size={18} color="var(--accent-color)" />
                      </a>
                      <button className="icon-btn icon-btn-danger" onClick={() => handleDelete(t._id)} title="Delete template">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr>
                  <td colSpan={8} className={styles.emptyCell}>
                    No templates found. Create one in the Strips Studio.
                  </td>
                </tr>
              )}
            </tbody>
          </table></div>
        )}
      </AdminTableCard>

      <AdminConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Hapus Template?"
        message="Apakah anda yakin ingin menghapus template ini?"
        confirmLabel="Hapus"
        loading={deleteLoading}
        variant="danger"
      />

      {renameTarget && (
        <AdminModal open={!!renameTarget} onClose={() => !renameLoading && setRenameTarget(null)} title="Edit Nama Template">
          <p style={{ color: '#666', fontSize: 14, marginBottom: 16 }}>Ubah nama template &quot;{renameTarget.templateName}&quot;</p>
          <input
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            placeholder="Nama template"
            autoFocus
            className="admin-input"
            style={{ width: '100%', marginBottom: 20 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && renameName.trim()) handleRenameSave(); }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button onClick={() => setRenameTarget(null)} disabled={renameLoading} className="btn btn-ghost">Batal</button>
            <button onClick={handleRenameSave} disabled={renameLoading || !renameName.trim()} className="btn btn-primary">
              {renameLoading ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </AdminModal>
      )}
    </div>
  );
}
