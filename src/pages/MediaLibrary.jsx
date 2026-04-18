// MediaLibrary.jsx — coach video upload UI.
// Renders the canonical exercise checklist (manifest) with per-row drop zones.
// Drag/drop or click to upload → POSTs straight to Cloudflare Stream via signed URL,
// then registers the row in trainer_media via Flask.

import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import manifest from '../data/exercise_manifest.json';

const s = {
  page: { maxWidth: '1100px', margin: '0 auto', padding: '24px 20px' },
  title: { fontSize: '24px', fontWeight: '700', marginBottom: '4px' },
  sub: { fontSize: '13px', color: '#888', marginBottom: '20px' },
  toolbar: {
    display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px',
    background: '#fff', padding: '12px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
  },
  search: { flex: '1 1 240px', padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' },
  select: { padding: '8px 10px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', background: '#fff' },
  toggle: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#444' },
  statRow: { display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' },
  stat: {
    flex: '1 1 140px', background: 'linear-gradient(135deg, #667eea, #764ba2)',
    borderRadius: '10px', padding: '12px 16px', color: '#fff',
  },
  statLabel: { fontSize: '11px', fontWeight: '600', opacity: 0.85 },
  statValue: { fontSize: '20px', fontWeight: '800' },
  catSection: { background: '#fff', borderRadius: '12px', padding: '16px', marginBottom: '14px', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' },
  catHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '6px 4px' },
  catName: { fontSize: '15px', fontWeight: '700', color: '#1a1a2e' },
  catMeta: { fontSize: '12px', color: '#888' },
  row: {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 6px',
    borderTop: '1px solid #f3f3f3', minHeight: '50px',
  },
  rowName: { flex: '1 1 200px', fontSize: '14px', color: '#222' },
  rowSub: { fontSize: '11px', color: '#888', marginLeft: '6px' },
  drop: {
    flex: '0 0 220px', border: '2px dashed #cfd8e3', borderRadius: '8px',
    padding: '8px 12px', textAlign: 'center', fontSize: '12px', color: '#666',
    cursor: 'pointer', background: '#fafbfd', transition: 'background 120ms',
  },
  dropActive: { background: '#eef2ff', borderColor: '#667eea', color: '#3b3b6c' },
  dropUploading: { background: '#fff7ed', borderColor: '#f59e0b', color: '#92400e' },
  dropDone: { background: '#ecfdf5', borderColor: '#10b981', color: '#065f46' },
  dropError: { background: '#fef2f2', borderColor: '#ef4444', color: '#991b1b' },
  thumb: {
    flex: '0 0 220px', display: 'flex', alignItems: 'center', gap: '8px',
    background: '#f0fdf4', borderRadius: '8px', padding: '8px 10px', fontSize: '12px',
  },
  smallBtn: {
    padding: '4px 10px', border: 'none', borderRadius: '6px',
    fontSize: '11px', fontWeight: '600', cursor: 'pointer',
  },
  videoBtn: { background: '#667eea', color: '#fff' },
  delBtn: { background: '#fee2e2', color: '#991b1b' },
  defaultBadge: {
    display: 'inline-block', fontSize: '10px', color: '#777',
    background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', marginLeft: '4px',
  },
  yourBadge: {
    display: 'inline-block', fontSize: '10px', color: '#065f46',
    background: '#d1fae5', padding: '2px 6px', borderRadius: '4px', marginLeft: '4px', fontWeight: '600',
  },
  videoPanel: {
    flex: '0 0 100%', marginTop: '8px', background: '#000', borderRadius: '8px',
    overflow: 'hidden', aspectRatio: '16/9',
  },
};

export default function MediaLibrary() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [libFilter, setLibFilter] = useState('all');
  const [hideHasMine, setHideHasMine] = useState(false);
  const [collapsed, setCollapsed] = useState({}); // categoryKey -> bool
  const [myMedia, setMyMedia] = useState([]);
  const [perRow, setPerRow] = useState({}); // key -> { state: 'idle'|'uploading'|'done'|'error', progress, message, uid }
  const [openVideo, setOpenVideo] = useState(null);

  // Fetch existing uploads
  useEffect(() => {
    api.myMedia().then((r) => setMyMedia(r.uploads || [])).catch(() => setMyMedia([]));
  }, []);

  const myByKey = useMemo(() => {
    const map = {};
    for (const m of myMedia) map[`${m.source_library}::${m.exercise_name}`] = m;
    return map;
  }, [myMedia]);

  // Group manifest by source_library + category
  const grouped = useMemo(() => {
    const out = {};
    for (const e of manifest.exercises) {
      if (libFilter !== 'all' && e.source_library !== libFilter) continue;
      if (search && !e.name.toLowerCase().includes(search.toLowerCase())) continue;
      const key = `${e.source_library}::${e.category}`;
      if (hideHasMine && myByKey[`${e.source_library}::${e.name}`]) continue;
      if (!out[key]) out[key] = { source_library: e.source_library, category: e.category, items: [] };
      out[key].items.push(e);
    }
    return Object.values(out).sort((a, b) => (a.source_library + a.category).localeCompare(b.source_library + b.category));
  }, [search, libFilter, hideHasMine, myByKey]);

  const handleFile = async (exercise, file) => {
    const key = `${exercise.source_library}::${exercise.name}`;
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setPerRow((p) => ({ ...p, [key]: { state: 'error', message: 'Not a video file' } }));
      return;
    }
    setPerRow((p) => ({ ...p, [key]: { state: 'uploading', progress: 0 } }));
    try {
      // 1. Mint upload URL — tag with exercise + coach name so Cloudflare stores a
      //    meaningful label instead of the client's original filename.
      const coachName = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
      const { uploadURL, uid } = await api.mediaUploadUrl({
        mediaType: 'video',
        exerciseName: exercise.name,
        coachName,
      });
      // 2. Upload bytes (XHR for progress)
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadURL);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setPerRow((p) => ({ ...p, [key]: { state: 'uploading', progress: pct } }));
          }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload HTTP ${xhr.status}`)));
        xhr.onerror = () => reject(new Error('Upload network error'));
        const fd = new FormData();
        fd.append('file', file);
        xhr.send(fd);
      });
      // 3. Register in DB
      await api.mediaRegister({
        exercise_name: exercise.name,
        category: exercise.category,
        source_library: exercise.source_library,
        media_type: 'video',
        cloudflare_uid: uid,
      });
      // 4. Refresh list
      const fresh = await api.myMedia();
      setMyMedia(fresh.uploads || []);
      setPerRow((p) => ({ ...p, [key]: { state: 'done', uid } }));
    } catch (err) {
      setPerRow((p) => ({ ...p, [key]: { state: 'error', message: err.message } }));
    }
  };

  const handleDelete = async (exercise) => {
    if (!confirm(`Remove your video for "${exercise.name}"?`)) return;
    try {
      await api.deleteMedia(exercise.name, 'video');
      const fresh = await api.myMedia();
      setMyMedia(fresh.uploads || []);
      const key = `${exercise.source_library}::${exercise.name}`;
      setPerRow((p) => {
        const np = { ...p };
        delete np[key];
        return np;
      });
    } catch (err) {
      alert(err.message);
    }
  };

  const totalExercises = manifest.exercises.length;
  const myCount = myMedia.length;

  return (
    <div style={s.page}>
      <h1 style={s.title}>Your Video Library</h1>
      <p style={s.sub}>
        Upload your own video for any exercise. Your clients (and anyone who signs up under you) will see your version
        instead of the platform default.
      </p>

      <div style={s.statRow}>
        <div style={s.stat}>
          <div style={s.statLabel}>YOUR UPLOADS</div>
          <div style={s.statValue}>{myCount}</div>
        </div>
        <div style={{ ...s.stat, background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
          <div style={s.statLabel}>EXERCISES IN LIBRARY</div>
          <div style={s.statValue}>{totalExercises.toLocaleString()}</div>
        </div>
        <div style={{ ...s.stat, background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
          <div style={s.statLabel}>COVERAGE</div>
          <div style={s.statValue}>{totalExercises ? Math.round((myCount / totalExercises) * 100) : 0}%</div>
        </div>
      </div>

      <div style={s.toolbar}>
        <input
          type="text"
          placeholder="Search exercises…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={s.search}
        />
        <select value={libFilter} onChange={(e) => setLibFilter(e.target.value)} style={s.select}>
          <option value="all">All libraries</option>
          <option value="exerciseLibrary">Strength</option>
          <option value="martialArtsLibrary">Martial Arts</option>
          <option value="mobilityExercises">Mobility</option>
          <option value="warmupExercises">Warm-up</option>
        </select>
        <label style={s.toggle}>
          <input
            type="checkbox"
            checked={hideHasMine}
            onChange={(e) => setHideHasMine(e.target.checked)}
          />
          Hide ones I've uploaded
        </label>
      </div>

      {grouped.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>No exercises match your filter.</div>
      )}

      {grouped.map((group) => {
        const ck = `${group.source_library}::${group.category}`;
        const isCollapsed = collapsed[ck];
        const minePerCat = group.items.filter((e) => myByKey[`${e.source_library}::${e.name}`]).length;
        return (
          <div key={ck} style={s.catSection}>
            <div style={s.catHeader} onClick={() => setCollapsed((c) => ({ ...c, [ck]: !c[ck] }))}>
              <div>
                <span style={s.catName}>
                  {group.category}
                  <span style={s.rowSub}>({libLabel(group.source_library)})</span>
                </span>
              </div>
              <div style={s.catMeta}>
                {minePerCat}/{group.items.length} uploaded · {isCollapsed ? '▶' : '▼'}
              </div>
            </div>
            {!isCollapsed &&
              group.items.map((ex) => {
                const key = `${ex.source_library}::${ex.name}`;
                const mine = myByKey[key];
                const state = perRow[key];
                return (
                  <div key={key} style={{ display: 'block' }}>
                    <div style={s.row}>
                      <div style={s.rowName}>
                        {ex.name}
                        {ex.subcategory && <span style={s.rowSub}>{ex.subcategory}</span>}
                        {ex.has_default_video && !mine && <span style={s.defaultBadge}>has default video</span>}
                        {mine && <span style={s.yourBadge}>YOURS</span>}
                      </div>
                      {mine ? (
                        <div style={s.thumb}>
                          <span>✅ Live</span>
                          <button
                            style={{ ...s.smallBtn, ...s.videoBtn }}
                            onClick={() => setOpenVideo((o) => (o === key + ':mine' ? null : key + ':mine'))}
                          >
                            {openVideo === key + ':mine' ? 'Hide' : 'Preview'}
                          </button>
                          <button style={{ ...s.smallBtn, ...s.delBtn }} onClick={() => handleDelete(ex)}>
                            Remove
                          </button>
                        </div>
                      ) : (
                        <>
                          {ex.default_video_uid && (
                            <button
                              style={{ ...s.smallBtn, background: '#e0e7ff', color: '#3730a3', flex: '0 0 auto', marginRight: '4px' }}
                              onClick={() => setOpenVideo((o) => (o === key + ':default' ? null : key + ':default'))}
                              title="Preview the platform default video for this exercise"
                            >
                              {openVideo === key + ':default' ? 'Hide default' : '▶ Default'}
                            </button>
                          )}
                          <DropZone exercise={ex} state={state} onFile={(f) => handleFile(ex, f)} />
                        </>
                      )}
                    </div>
                    {openVideo === key + ':mine' && mine && (
                      <div style={s.videoPanel}>
                        <iframe
                          src={`https://iframe.videodelivery.net/${mine.cloudflare_uid}?preload=metadata`}
                          style={{ width: '100%', height: '100%', border: 'none' }}
                          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    )}
                    {openVideo === key + ':default' && ex.default_video_uid && (
                      <div style={s.videoPanel}>
                        <iframe
                          src={`https://iframe.videodelivery.net/${ex.default_video_uid}?preload=metadata`}
                          style={{ width: '100%', height: '100%', border: 'none' }}
                          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

function libLabel(id) {
  switch (id) {
    case 'exerciseLibrary': return 'Strength';
    case 'martialArtsLibrary': return 'Martial Arts';
    case 'mobilityExercises': return 'Mobility';
    case 'warmupExercises': return 'Warm-up';
    default: return id;
  }
}

function DropZone({ exercise, state, onFile }) {
  const [hover, setHover] = useState(false);
  const inputRef = useRef(null);
  const onDrop = (e) => {
    e.preventDefault();
    setHover(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };
  let style = s.drop;
  let label = 'Drop or click to upload';
  if (hover) style = { ...s.drop, ...s.dropActive };
  if (state?.state === 'uploading') {
    style = { ...s.drop, ...s.dropUploading };
    label = `Uploading ${state.progress ?? 0}%…`;
  } else if (state?.state === 'done') {
    style = { ...s.drop, ...s.dropDone };
    label = '✅ Uploaded — refreshing…';
  } else if (state?.state === 'error') {
    style = { ...s.drop, ...s.dropError };
    label = `Error: ${state.message}`;
  }
  return (
    <div
      style={style}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setHover(true); }}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
    >
      {label}
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
}
