const BACKEND_URL = '/api';

const TYPE_LABELS = { character: 'Character', object: 'Object', location: 'Location' };
const TYPE_COLORS = { character: '#3b82f6', object: '#10b981', location: '#f59e0b' };

/** Sinkron dengan server.js — fallback jika /api/config belum load */
const MODEL_CATALOG_FALLBACK = {
  prompt: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'free', note: 'Default — rekomendasi perhalus prompt. Cepat, kuota gratis harian.' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', tier: 'free', note: 'Versi lebih ringan 2.5, hemat kuota.' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'limited', note: 'Kualitas tertinggi 2.5, gratis terbatas.' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tier: 'free', note: 'Generasi 2.0, cepat, kuota gratis.' },
    { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', tier: 'free', note: 'Paling ringan, kuota gratis besar.' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', tier: 'free', note: 'Legacy stabil, gratis terbatas.' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', tier: 'limited', note: 'Legacy pro, gratis terbatas.' }
  ],
  image: [
    { id: 'gemini-2.5-flash-image', label: 'Nano Banana', tier: 'free', note: 'Default — cepat, kuota gratis harian.' },
    { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2', tier: 'limited', note: 'Kualitas lebih tinggi, gratis terbatas / kuota API.' },
    { id: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2 (Preview)', tier: 'limited', note: 'Preview Nano Banana 2 jika model stabil belum ada.' },
    { id: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro', tier: 'paid', note: 'Kualitas studio; berbayar per generate.' },
    { id: 'gemini-2.0-flash-preview-image-generation', label: 'Nano Banana (2.0 Preview)', tier: 'limited', note: 'Legacy preview, gratis terbatas.' }
  ]
};

function modelTierSuffix(tier) {
  if (tier === 'free') return ' (Gratis)';
  if (tier === 'limited') return ' (Gratis terbatas)';
  if (tier === 'paid') return ' (Berbayar)';
  return '';
}

function toImageSrc(imageBase64) {
  if (!imageBase64) return '';
  if (String(imageBase64).startsWith('data:')) return imageBase64;
  return 'data:image/png;base64,' + imageBase64;
}

function downloadImageFromSrc(src, filename) {
  const link = document.createElement('a');
  link.download = filename || `comic-${Date.now()}.png`;
  link.href = src;
  link.click();
}

export function createComicGeneratorPage() {
  const refs = {};
  let selectedReferences = [];
  let characterProperties = {}; // Store properties per character

  // State
  const state = {
    references: [],
    filteredReferences: [],
    loading: false,
    generating: false,
    enhancingPrompt: false,
    generatedImage: null,
    prompt: '',
    uploadName: '',
    uploadType: 'character',
    searchQuery: '',
    filterType: 'all',
    modelConfig: null,
    promptModel: 'gemini-2.5-flash',
    imageModel: 'gemini-2.5-flash-image',
    comicStyle: 'manga',
    cameraAngle: 'medium',
    narrator: '',
    dialogue: '',
    speechMode: 'auto'
  };

  function getComicOptions() {
    return {
      comic_style: state.comicStyle,
      camera_angle: state.cameraAngle,
      narrator: state.narrator.trim(),
      dialogue: state.dialogue.trim(),
      speech_mode: state.speechMode
    };
  }

  async function fetchModelConfig() {
    try {
      const res = await fetch(`${BACKEND_URL}/config`);
      const data = await res.json();
      if (data.success) {
        state.modelConfig = data.data;
        state.promptModel = data.data.defaults.prompt;
        state.imageModel = data.data.defaults.image;
        renderModelSelects();
        if (!data.data.hasApiKey) {
          layout.toast('GEMINI_API_KEY belum di-set di .env.local', { type: 'warning' });
        }
      }
    } catch (e) {
      console.error('Failed to load model config:', e);
    }
  }

  function getModelLabel(modelId, type) {
    const list = state.modelConfig?.models?.[type] || [];
    const found = list.find(m => m.id === modelId);
    return found ? found.label : modelId;
  }

  function getModelNote(modelId, type) {
    const list = state.modelConfig?.models?.[type] || [];
    const found = list.find(m => m.id === modelId);
    return found ? found.note : '';
  }

  function updateModelHints() {
    if (refs.promptModelHint) {
      const note = getModelNote(state.promptModel, 'prompt');
      const tier = state.modelConfig?.models?.prompt?.find(m => m.id === state.promptModel)?.tier;
      const tierText = tier === 'free' ? 'Gratis' : tier === 'limited' ? 'Gratis terbatas' : tier === 'paid' ? 'Berbayar' : '';
      refs.promptModelHint.textContent = note + (tierText ? ` · ${tierText}` : '');
    }
    if (refs.imageModelHint) {
      const note = getModelNote(state.imageModel, 'image');
      const tier = state.modelConfig?.models?.image?.find(m => m.id === state.imageModel)?.tier;
      const tierText = tier === 'free' ? 'Gratis' : tier === 'limited' ? 'Gratis terbatas' : tier === 'paid' ? 'Berbayar' : '';
      refs.imageModelHint.textContent = note + (tierText ? ` · ${tierText}` : '');
    }
  }

  function buildModelSelectOptions(models, selectedId) {
    return (models || []).map(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.label}${modelTierSuffix(m.tier)}`;
      if (m.id === selectedId) opt.selected = true;
      return opt;
    });
  }

  function renderModelSelects() {
    const catalog = state.modelConfig?.models || MODEL_CATALOG_FALLBACK;

    if (refs.promptModelSelect) {
      el(refs.promptModelSelect)
        .clear()
        .child(buildModelSelectOptions(catalog.prompt, state.promptModel))
        .get();
      refs.promptModelSelect.value = state.promptModel;
    }

    if (refs.imageModelSelect) {
      el(refs.imageModelSelect)
        .clear()
        .child(buildModelSelectOptions(catalog.image, state.imageModel))
        .get();
      refs.imageModelSelect.value = state.imageModel;
    }

    updateModelHints();
    if (refs.headerModelLabel) {
      refs.headerModelLabel.textContent = 'Model gambar: ' + getModelLabel(state.imageModel, 'image');
    }
  }

  // API Functions
  async function fetchReferences() {
    try {
      const res = await fetch(`${BACKEND_URL}/references`);
      const data = await res.json();
      if (data.success) {
        state.references = data.data;
        applyFilters();
      }
    } catch (error) {
      console.error('Failed to fetch references:', error);
      if (refs.referencesList) {
        el(refs.referencesList).clear().child(
          el('div').css({ color: '#dc2626', padding: '1rem' }).text('Failed to connect to backend. Pastikan server.js berjalan.')
        ).get();
      }
    }
  }

  function buildGalleryCard({ prompt, createdAt, imageSrc }) {
    return el('div').css({
      background: '#1e293b',
      borderRadius: '0.75rem',
      overflow: 'hidden',
      border: '1px solid #334155',
      transition: 'transform 0.2s ease, box-shadow 0.2s ease'
    })
      .mouseover(function() {
        this.style.transform = 'translateY(-2px)';
        this.style.boxShadow = '0 10px 28px rgba(0, 0, 0, 0.35)';
      })
      .mouseout(function() {
        this.style.transform = '';
        this.style.boxShadow = '';
      })
      .child([
        el('div').css({ padding: '0.75rem', background: '#0f172a', borderBottom: '1px solid #334155' }).child([
          el('div').text(prompt).attr('title', prompt).css({
            fontSize: '0.85rem',
            color: '#e2e8f0',
            marginBottom: '0.25rem',
            lineHeight: '1.45',
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap'
          }),
          el('div').text(createdAt).css({ fontSize: '0.7rem', color: '#64748b' })
        ]),
        el('div').css({ position: 'relative' }).child([
          el('img').attr('src', imageSrc).css({
            width: '100%',
            display: 'block',
            aspectRatio: '1',
            objectFit: 'cover'
          }),
          el('button').css({
            position: 'absolute',
            bottom: '0.5rem',
            right: '0.5rem',
            padding: '0.4rem 0.7rem',
            background: 'rgba(15, 23, 42, 0.9)',
            color: '#e2e8f0',
            border: '1px solid #475569',
            borderRadius: '0.4rem',
            cursor: 'pointer',
            fontSize: '0.75rem',
            fontWeight: '600',
            backdropFilter: 'blur(4px)'
          }).child([
            el('i').class('fas fa-download').css({ marginRight: '0.35rem' }),
            el('span').text('Download')
          ]).click((e) => {
            e.stopPropagation();
            downloadImageFromSrc(imageSrc);
          })
        ])
      ]);
  }

  function renderGalleryEmpty() {
    if (!refs.generatedImageContainer) return;
    el(refs.generatedImageContainer).empty().child(
      el('div').css({
        gridColumn: '1 / -1',
        textAlign: 'center',
        padding: '3rem 1.5rem',
        color: '#64748b',
        border: '1px dashed #334155',
        borderRadius: '0.75rem',
        background: '#1e293b'
      }).child([
        el('i').class('fas fa-images').css({ fontSize: '2.5rem', color: '#475569', marginBottom: '0.75rem', display: 'block' }),
        el('div').text('Belum ada gambar').css({ fontSize: '1rem', fontWeight: '600', color: '#94a3b8', marginBottom: '0.35rem' }),
        el('div').text('Pilih referensi, tulis prompt, lalu klik Generate.').css({ fontSize: '0.85rem', lineHeight: '1.5' })
      ])
    ).get();
  }

  async function fetchGenerations() {
    try {
      const res = await fetch(`${BACKEND_URL}/generations`);
      const data = await res.json();

      if (!data.success) return;

      el(refs.generatedImageContainer).empty();

      if (data.data.length === 0) {
        renderGalleryEmpty();
        return;
      }

      data.data.forEach(gen => {
        el(refs.generatedImageContainer).append(buildGalleryCard({
          prompt: gen.prompt,
          createdAt: gen.created_at,
          imageSrc: toImageSrc(gen.image_base64)
        }));
      });
    } catch (error) {
      console.error('Failed to load generations:', error);
    }
  }

  function applyFilters() {
    let filtered = state.references;

    // Filter by type
    if (state.filterType !== 'all') {
      filtered = filtered.filter(ref => ref.type === state.filterType);
    }

    // Filter by search query
    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      filtered = filtered.filter(ref => 
        ref.name.toLowerCase().includes(query) ||
        ref.type.toLowerCase().includes(query)
      );
    }

    state.filteredReferences = filtered;
    if (refs.refCountBadge) {
      refs.refCountBadge.textContent = String(filtered.length);
    }
    renderReferencesList();
  }

  async function uploadReference() {
    const name = state.uploadName.trim();
    if (!name) {
      layout.toast('Masukkan nama referensi', { type: 'warning' });
      return;
    }

    if (!refs.imageUpload.files || refs.imageUpload.files.length === 0) {
      layout.toast('Pilih gambar terlebih dahulu', { type: 'warning' });
      return;
    }

    const file = refs.imageUpload.files[0];
    const reader = new FileReader();

    reader.onload = async function(e) {
      const image_base64 = e.target.result;

      try {
        const res = await fetch(`${BACKEND_URL}/references`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            type: state.uploadType,
            image_base64: image_base64
          })
        });

        const data = await res.json();

        if (data.success) {
          layout.toast(`Reference "${name}" uploaded successfully!`, { type: 'success' });
          state.uploadName = '';
          if (refs.uploadNameInput) refs.uploadNameInput.value = '';
          if (refs.imageUpload) refs.imageUpload.value = '';
          fetchReferences();
        } else {
          layout.toast('Error: ' + data.error, { type: 'error' });
        }
      } catch (error) {
        console.error('Upload failed:', error);
        layout.toast('Failed to upload reference. Is the backend running?', { type: 'error' });
      }
    };

    reader.readAsDataURL(file);
  }

  async function deleteReference(id) {
    layout.confirm({
      title: 'Delete Reference',
      message: 'Are you sure you want to delete this reference?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      onConfirm: async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/references/${id}`, {
            method: 'DELETE'
          });
          const data = await res.json();

          if (data.success) {
            layout.toast('Reference deleted', { type: 'success' });
            selectedReferences = selectedReferences.filter(rid => rid !== id);
            delete characterProperties[id];
            fetchReferences();
            renderSelectedChips();
            updateSelectionSummary();
          } else {
            layout.toast('Error: ' + data.error, { type: 'error' });
          }
        } catch (error) {
          console.error('Delete failed:', error);
          layout.toast('Failed to delete reference', { type: 'error' });
        }
      }
    });
  }

  function updateSelectionSummary() {
    if (!refs.selectionSummary) return;
    const count = selectedReferences.length;
    refs.selectionSummary.textContent = count === 0
      ? 'Belum ada referensi dipilih'
      : `${count} referensi dipilih — siap di-generate`;
    refs.selectionSummary.style.color = count === 0 ? '#f59e0b' : '#34d399';
  }

  async function enhanceScenePrompt() {
    const prompt = state.prompt.trim();
    if (!prompt) {
      layout.toast('Tulis ide adegan singkat dulu', { type: 'warning' });
      return;
    }

    state.enhancingPrompt = true;
    updateActionButtons();

    try {
      const res = await fetch(`${BACKEND_URL}/enhance-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          reference_ids: selectedReferences,
          character_properties: characterProperties,
          prompt_model: state.promptModel,
          comic_options: getComicOptions()
        })
      });

      const data = await res.json();

      if (data.success && data.data.prompt) {
        state.prompt = data.data.prompt;
        if (refs.promptInput) {
          refs.promptInput.value = data.data.prompt;
        }
        const modelMsg = data.data.model_used ? ` (${data.data.model_used})` : '';
        const truncated = /\s(dan|yang|dengan|sambil|di|ke|pada)\s*$/i.test(data.data.prompt.trim())
          || (data.data.prompt.length > 80 && !/[.!?…]$/.test(data.data.prompt.trim()));
        layout.toast(
          (truncated ? 'Prompt masih terpotong — coba Perhalus lagi atau Generate (akan dilengkapi otomatis)' : 'Prompt adegan diperhalus') + modelMsg,
          { type: truncated ? 'warning' : 'success' }
        );
      } else {
        layout.toast('Gagal memperhalus prompt: ' + (data.error || 'Unknown error'), { type: 'error' });
      }
    } catch (error) {
      console.error('Enhance prompt failed:', error);
      layout.toast('Gagal memperhalus prompt. Pastikan server dan API key aktif.', { type: 'error' });
    } finally {
      state.enhancingPrompt = false;
      updateActionButtons();
    }
  }

  async function generateComic() {
    const prompt = state.prompt.trim();
    if (!prompt) {
      layout.toast('Tulis prompt adegan terlebih dahulu', { type: 'warning' });
      return;
    }

    if (selectedReferences.length === 0) {
      layout.toast('Pilih minimal satu referensi dari daftar', { type: 'warning' });
      return;
    }

    // Show confirmation dialog
    layout.confirm({
      title: 'Generate Comic',
      message: `Buat komik dengan ${selectedReferences.length} referensi?\n\nPrompt: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`,
      confirmText: 'Generate',
      cancelText: 'Batal',
      onConfirm: async () => {
        await doGenerate();
      }
    });
  }


  async function doGenerate() {
    state.generating = true;
    updateActionButtons();

    try {
      const res = await fetch(`${BACKEND_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: state.prompt,
          reference_ids: selectedReferences,
          character_properties: characterProperties,
          prompt_model: state.promptModel,
          image_model: state.imageModel,
          comic_options: getComicOptions()
        })
      });

      const data = await res.json();

      if (data.success) {
        if (data.data.prompt_completed && data.data.prompt) {
          state.prompt = data.data.prompt;
          if (refs.promptInput) refs.promptInput.value = data.data.prompt;
          layout.toast('Prompt terpotong telah dilengkapi otomatis sebelum generate', { type: 'info' });
        }
        const generatedAt = new Date().toLocaleString();
        const imageSrc = toImageSrc(data.data.image_base64);
        const newImage = buildGalleryCard({
          prompt: state.prompt,
          createdAt: generatedAt,
          imageSrc
        });

        if (refs.generatedImageContainer && refs.generatedImageContainer.childElementCount <= 1) {
          el(refs.generatedImageContainer).empty();
        }

        el(refs.generatedImageContainer).prepend(newImage).get();
        const imgModel = data.data.image_model_used
          ? getModelLabel(data.data.image_model_used, 'image')
          : '';
        layout.toast(
          'Komik berhasil dibuat' + (imgModel ? ` · ${imgModel}` : ''),
          { type: 'success' }
        );
      } else {
        layout.toast('Generation failed: ' + data.error, { type: 'error' });
      }
    } catch (error) {
      console.error('Generation failed:', error);
      layout.toast('Failed to generate comic. Is the backend running?', { type: 'error' });
    } finally {
      state.generating = false;
      updateActionButtons();
    }
  }

  function renderReferencesList() {
    if (!refs.referencesList) return;

    const refsToShow = state.filteredReferences;

    if (refsToShow.length === 0) {
      el(refs.referencesList).clear().child(
        el('div').css({
          color: '#64748b',
          padding: '1.5rem',
          textAlign: 'center',
          fontSize: '0.85rem',
          lineHeight: '1.5'
        }).child([
          el('i').class('fas fa-user-plus').css({ fontSize: '1.5rem', color: '#475569', marginBottom: '0.5rem', display: 'block' }),
          el('div').text(state.references.length === 0 ? 'Upload referensi pertama Anda' : 'Tidak ada hasil filter'),
          state.references.length === 0
            ? el('div').text('Karakter, objek, atau lokasi untuk konsistensi gambar.').css({ fontSize: '0.75rem', marginTop: '0.35rem', color: '#475569' })
            : null
        ])
      ).get();
      return;
    }

    const items = refsToShow.map(ref => {
      const isSelected = selectedReferences.includes(ref.id);
      const hasProps = characterProperties[ref.id] && Object.keys(characterProperties[ref.id]).length > 0;

      return el('div').css({
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.65rem',
        border: isSelected ? '2px solid #3b82f6' : '1px solid #334155',
        borderRadius: '0.5rem',
        background: isSelected ? '#1e3a5f' : '#0f172a',
        cursor: 'pointer',
        transition: 'all 0.2s'
      }).click((e) => {
        if (e.target.closest('.ref-action-btn')) return;
        toggleReference(ref.id);
      }).child([
        el('input')
          .attr('type', 'checkbox')
          .attr('checked', isSelected)
          .css({ cursor: 'pointer', pointerEvents: 'none' }),
        el('div').css({
          width: '40px',
          height: '40px',
          borderRadius: '0.35rem',
          overflow: 'hidden',
          flexShrink: '0',
          border: '1px solid #334155'
        }).child(
          el('img').attr('src', toImageSrc(ref.image_base64)).css({ width: '100%', height: '100%', objectFit: 'cover' })
        ),
        el('div').css({ flex: '1', minWidth: '0' }).child([
          el('div').css({ display: 'flex', alignItems: 'center', gap: '0.4rem' }).child([
            el('div').text(ref.name).css({ fontWeight: '600', color: '#e2e8f0', fontSize: '0.85rem' }),
            hasProps ? el('i').class('fas fa-cog').css({ fontSize: '0.65rem', color: '#3b82f6' }) : null
          ]),
          el('div').css({ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.2rem' }).child([
            el('span').text(TYPE_LABELS[ref.type] || ref.type).css({
              fontSize: '0.6rem',
              padding: '0.1rem 0.4rem',
              borderRadius: '999px',
              background: TYPE_COLORS[ref.type] + '30',
              color: TYPE_COLORS[ref.type],
              fontWeight: '600',
              textTransform: 'uppercase'
            })
          ])
        ]),
        el('div').css({ display: 'flex', gap: '0.35rem' }).child([
          el('button')
            .class('ref-action-btn')
            .css({
              padding: '0.3rem 0.5rem',
              background: '#1e293b',
              color: '#94a3b8',
              border: '1px solid #334155',
              borderRadius: '0.3rem',
              cursor: 'pointer',
              fontSize: '0.7rem'
            })
            .click((e) => {
              e.stopPropagation();
              showCharacterPropertiesDialog(ref);
            })
            .child([
              el('i').class('fas fa-sliders-h')
            ]),
          el('button')
            .class('ref-action-btn')
            .css({
              padding: '0.3rem 0.5rem',
              background: '#7f1d1d',
              color: '#fca5a5',
              border: 'none',
              borderRadius: '0.3rem',
              cursor: 'pointer',
              fontSize: '0.7rem'
            })
            .click((e) => {
              e.stopPropagation();
              deleteReference(ref.id);
            })
            .child([
              el('i').class('fas fa-trash')
            ])
        ])
      ]);
    });

    el(refs.referencesList).clear().child(items).get();
  }

  function toggleReference(id) {
    const idx = selectedReferences.indexOf(id);
    if (idx > -1) {
      selectedReferences.splice(idx, 1);
    } else {
      selectedReferences.push(id);
    }
    renderReferencesList();
    renderSelectedChips();
    updateSelectionSummary();
  }

  function renderSelectedChips() {
    if (!refs.selectedChipsContainer) return;

    if (selectedReferences.length === 0) {
      el(refs.selectedChipsContainer).empty().child(
        el('div').css({
          color: '#64748b',
          padding: '0.5rem',
          textAlign: 'center',
          fontSize: '0.8rem'
        }).text('Klik referensi di sidebar untuk memilih')
      ).get();
      return;
    }

    const chips = selectedReferences.map(id => {
      const ref = state.references.find(r => r.id === id);
      if (!ref) return null;
      const hasProps = characterProperties[ref.id] && Object.keys(characterProperties[ref.id]).length > 0;

      return el('div').css({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.4rem 0.75rem',
        background: hasProps ? '#1e3a5f' : '#1e293b',
        border: hasProps ? '1px solid #3b82f6' : '1px solid #334155',
        borderRadius: '999px',
        cursor: 'pointer'
      }).click(() => showCharacterPropertiesDialog(ref)).child([
        el('img').attr('src', toImageSrc(ref.image_base64)).css({ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }),
        el('span').text(ref.name).css({ fontSize: '0.8rem', color: '#e2e8f0' }),
        hasProps ? el('i').class('fas fa-cog').css({ fontSize: '0.65rem', color: '#3b82f6' }) : null,
        el('i').class('fas fa-times').css({ fontSize: '0.65rem', color: '#94a3b8', cursor: 'pointer' }).click((e) => { e.stopPropagation(); toggleReference(ref.id); })
      ]);
    });

    el(refs.selectedChipsContainer).empty().child(chips.filter(Boolean)).get();
  }

  function showCharacterPropertiesDialog(ref) {
    const props = characterProperties[ref.id] || {};
    
    layout.modal({
      title: `Properti: ${ref.name}`,
      size: 'medium',
      content: el('div').css({ display: 'flex', flexDirection: 'column', gap: '1rem' }).child([
        el('div').text('Opsional — membantu AI memahami pose dan ekspresi karakter.').css({
          fontSize: '0.8rem',
          color: '#94a3b8',
          lineHeight: '1.4'
        }),
        el('div').child([
          el('label').text('Pose / Posisi').css({ display: 'block', fontWeight: '600', marginBottom: '0.5rem', color: '#e2e8f0' }),
          el('input').attr('type', 'text').attr('placeholder', 'mis. berdiri, duduk, berlari').attr('value', props.pose || '').css({
            width: '100%',
            padding: '0.5rem',
            border: '1px solid #334155',
            borderRadius: '0.375rem',
            background: '#0f172a',
            color: '#e2e8f0',
            boxSizing: 'border-box'
          }).on('input', function(e) {
            if (!characterProperties[ref.id]) characterProperties[ref.id] = {};
            characterProperties[ref.id].pose = e.target.value;
          })
        ]),
        el('div').child([
          el('label').text('Ekspresi').css({ display: 'block', fontWeight: '600', marginBottom: '0.5rem', color: '#e2e8f0' }),
          el('input').attr('type', 'text').attr('placeholder', 'mis. senang, marah, terkejut').attr('value', props.expression || '').css({
            width: '100%',
            padding: '0.5rem',
            border: '1px solid #334155',
            borderRadius: '0.375rem',
            background: '#0f172a',
            color: '#e2e8f0',
            boxSizing: 'border-box'
          }).on('input', function(e) {
            if (!characterProperties[ref.id]) characterProperties[ref.id] = {};
            characterProperties[ref.id].expression = e.target.value;
          })
        ]),
        el('div').child([
          el('label').text('Pakaian / Aksesoris').css({ display: 'block', fontWeight: '600', marginBottom: '0.5rem', color: '#e2e8f0' }),
          el('input').attr('type', 'text').attr('placeholder', 'mis. jaket merah, topi').attr('value', props.clothing || '').css({
            width: '100%',
            padding: '0.5rem',
            border: '1px solid #334155',
            borderRadius: '0.375rem',
            background: '#0f172a',
            color: '#e2e8f0',
            boxSizing: 'border-box'
          }).on('input', function(e) {
            if (!characterProperties[ref.id]) characterProperties[ref.id] = {};
            characterProperties[ref.id].clothing = e.target.value;
          })
        ]),
        el('div').child([
          el('label').text('Catatan tambahan').css({ display: 'block', fontWeight: '600', marginBottom: '0.5rem', color: '#e2e8f0' }),
          el('textarea').attr('placeholder', 'Detail lain tentang karakter').attr('rows', '3').css({
            width: '100%',
            padding: '0.5rem',
            border: '1px solid #334155',
            borderRadius: '0.375rem',
            fontFamily: 'Roboto, sans-serif',
            resize: 'vertical',
            background: '#0f172a',
            color: '#e2e8f0',
            boxSizing: 'border-box'
          }).on('input', function(e) {
            if (!characterProperties[ref.id]) characterProperties[ref.id] = {};
            characterProperties[ref.id].notes = e.target.value;
          }).text(props.notes || '')
        ])
      ]),
      buttons: [
        {
          text: 'Simpan',
          onClick: () => {
            layout.toast(`Properti disimpan untuk ${ref.name}`, { type: 'success' });
            renderReferencesList();
            renderSelectedChips();
          }
        },
        {
          text: 'Hapus',
          variant: 'outline',
          onClick: () => {
            delete characterProperties[ref.id];
            layout.toast('Properti dihapus', { type: 'info' });
            renderReferencesList();
            renderSelectedChips();
          }
        }
      ]
    });
  }

  // Render Functions
  function downloadImage() {
    if (!state.generatedImage) return;

    const link = document.createElement('a');
    link.download = `comic-${Date.now()}.png`;
    link.href = state.generatedImage;
    link.click();
  }

  function renderGeneratedImage() {
    if (!refs.generatedImageContainer || !state.generatedImage) return;

    el(refs.generatedImageContainer).empty().child([
      el('div').css({
        border: '1px solid #e2e8f0',
        borderRadius: '0.75rem',
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)'
      }).child([
        el('img').attr('src', state.generatedImage).css({
          width: '100%',
          display: 'block'
        }),
        el('div').css({
          padding: '0.75rem',
          display: 'flex',
          justifyContent: 'flex-end'
        }).child(
          el('button').text('Download Image').css({
            padding: '0.5rem 1rem',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontWeight: '600'
          }).click(downloadImage)
        )
      ])
    ]).get();
  }

  function updateActionButtons() {
    const busy = state.generating || state.enhancingPrompt;

    if (refs.generateBtn) {
      if (state.generating) {
        refs.generateBtn.textContent = 'Membuat gambar...';
      } else {
        refs.generateBtn.textContent = 'Generate Comic';
      }
      refs.generateBtn.disabled = busy;
      refs.generateBtn.style.opacity = busy ? '0.6' : '1';
      refs.generateBtn.style.cursor = busy ? 'not-allowed' : 'pointer';
    }

    if (refs.enhancePromptBtn) {
      if (refs.enhancePromptLabel) {
        refs.enhancePromptLabel.textContent = state.enhancingPrompt ? 'Memperhalus...' : 'Perhalus dengan AI';
      }
      refs.enhancePromptBtn.disabled = busy;
      refs.enhancePromptBtn.style.opacity = busy ? '0.6' : '1';
      refs.enhancePromptBtn.style.cursor = busy ? 'not-allowed' : 'pointer';
    }
  }

  const inputStyle = {
    width: '100%',
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '0.5rem',
    padding: '0.6rem 0.75rem',
    fontSize: '0.85rem',
    color: '#e2e8f0',
    boxSizing: 'border-box'
  };

  const page = el('div').css({
    width: '100%',
    height: '100dvh',
    minHeight: '100dvh',
    maxHeight: '100dvh',
    display: 'flex',
    background: '#0f172a',
    color: '#e2e8f0',
    fontFamily: 'Roboto, sans-serif',
    overflow: 'hidden',
    boxSizing: 'border-box'
  }).child([
    el('div').css({
      width: '300px',
      flexShrink: '0',
      background: '#1e293b',
      borderRight: '1px solid #334155',
      overflowY: 'auto',
      padding: '1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '1rem'
    }).child([
      el('div').css({
        padding: '0.75rem',
        background: '#0f172a',
        borderRadius: '0.5rem',
        border: '1px solid #334155'
      }).child([
        el('div').text('Cara pakai').css({ fontSize: '0.75rem', fontWeight: '700', color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }),
        el('div').css({ fontSize: '0.78rem', color: '#cbd5e1', lineHeight: '1.55' }).child([
          el('div').text('1. Upload referensi'),
          el('div').text('2. Pilih dari daftar'),
          el('div').text('3. Tulis prompt & generate')
        ])
      ]),
      el('div').css({
        padding: '1rem',
        background: '#0f172a',
        borderRadius: '0.65rem',
        border: '1px solid #334155'
      }).child([
        el('div').css({ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }).child([
          el('i').class('fas fa-cloud-upload-alt').css({ color: '#10b981' }),
          el('div').text('Upload Referensi').css({ fontSize: '0.85rem', fontWeight: '700', color: '#e2e8f0' })
        ]),
        el('input').link(refs, 'uploadNameInput').attr('type', 'text').attr('placeholder', 'Nama (mis. Dina)').css({ ...inputStyle, marginBottom: '0.5rem' }).on('input', function(e) {
          state.uploadName = e.target.value;
        }),
        el('select').link(refs, 'uploadTypeSelect').css({ ...inputStyle, marginBottom: '0.5rem' }).child([
          el('option').text('Karakter').attr('value', 'character'),
          el('option').text('Objek').attr('value', 'object'),
          el('option').text('Lokasi').attr('value', 'location')
        ]).on('change', function(e) {
          state.uploadType = e.target.value;
        }),
        el('input').link(refs, 'imageUpload').attr('type', 'file').attr('accept', 'image/*').css({ width: '100%', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.75rem' }),
        el('button').text('Upload').css({
          width: '100%',
          background: '#10b981',
          color: '#fff',
          border: 'none',
          borderRadius: '0.5rem',
          padding: '0.65rem',
          cursor: 'pointer',
          fontWeight: '600',
          fontSize: '0.85rem'
        }).click(uploadReference)
      ]),
      el('div').child([
        el('div').css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }).child([
          el('div').text('Daftar Referensi').css({ fontSize: '0.85rem', fontWeight: '700', color: '#e2e8f0' }),
          el('div').link(refs, 'refCountBadge').text('0').css({
            fontSize: '0.7rem',
            padding: '0.15rem 0.5rem',
            background: '#334155',
            borderRadius: '999px',
            color: '#94a3b8',
            fontWeight: '600'
          })
        ]),
        el('div').css({ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem' }).child([
          el('input').link(refs, 'searchInput').attr('type', 'text').attr('placeholder', 'Cari nama...').css({ ...inputStyle, flex: '1', padding: '0.45rem 0.6rem', fontSize: '0.8rem' }).on('input', function(e) {
            state.searchQuery = e.target.value;
            applyFilters();
          }),
          el('select').link(refs, 'filterTypeSelect').css({ ...inputStyle, width: 'auto', minWidth: '5.5rem', padding: '0.45rem 0.5rem', fontSize: '0.8rem' }).child([
            el('option').text('Semua').attr('value', 'all'),
            el('option').text('Karakter').attr('value', 'character'),
            el('option').text('Objek').attr('value', 'object'),
            el('option').text('Lokasi').attr('value', 'location')
          ]).on('change', function(e) {
            state.filterType = e.target.value;
            applyFilters();
          })
        ]),
        el('div').link(refs, 'referencesList').css({
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          maxHeight: 'min(420px, 40vh)',
          overflowY: 'auto',
          paddingRight: '0.15rem'
        })
      ])
    ]),
    el('div').css({
      flex: '1',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      minWidth: '0'
    }).child([
      el('div').css({
        padding: '0.85rem 1.25rem',
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap'
      }).child([
        el('div').child([
          el('div').text('Comic Generator').css({ fontSize: '1.05rem', fontWeight: '700', color: '#e2e8f0' }),
          el('div').link(refs, 'headerModelLabel').text('Model gambar: …').css({ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.15rem' })
        ]),
        el('button').css({
          padding: '0.5rem 1rem',
          background: '#0f172a',
          color: '#e2e8f0',
          border: '1px solid #334155',
          borderRadius: '0.5rem',
          cursor: 'pointer',
          fontSize: '0.8rem',
          fontWeight: '600',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }).child([
          el('i').class('fas fa-database').css({ fontSize: '0.75rem' }),
          el('span').text('Data Tersimpan')
        ]).click(() => layout.navigate('/saved-data'))
      ]),
      el('div').css({
        flex: '1',
        display: 'flex',
        overflow: 'hidden',
        minHeight: '0'
      }).child([
        el('div').css({
          width: 'min(440px, 42vw)',
          flexShrink: '0',
          padding: '1.25rem',
          background: '#1e293b',
          borderRight: '1px solid #334155',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
          overflowY: 'auto'
        }).child([
          el('div').text('Buat Komik').css({ fontSize: '0.9rem', fontWeight: '700', color: '#e2e8f0' }),
          el('div').css({
            padding: '0.75rem',
            background: '#0f172a',
            borderRadius: '0.5rem',
            border: '1px solid #334155'
          }).child([
            el('div').text('Pengaturan Model AI').css({
              fontSize: '0.75rem',
              fontWeight: '700',
              color: '#94a3b8',
              marginBottom: '0.6rem',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }),
            el('div').css({ marginBottom: '0.55rem' }).child([
              el('label').text('Perhalus prompt').css({ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }),
              el('select')
                .link(refs, 'promptModelSelect')
                .css({ ...inputStyle, fontSize: '0.8rem', width: '100%', maxWidth: '100%' })
                .child(buildModelSelectOptions(MODEL_CATALOG_FALLBACK.prompt, state.promptModel))
                .change(function() {
                  state.promptModel = this.value;
                  updateModelHints();
                }),
              el('div').link(refs, 'promptModelHint').css({ fontSize: '0.68rem', color: '#64748b', marginTop: '0.25rem', lineHeight: '1.35', wordBreak: 'break-word', whiteSpace: 'normal' })
            ]),
            el('div').child([
              el('label').text('Generate gambar').css({ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }),
              el('select')
                .link(refs, 'imageModelSelect')
                .css({ ...inputStyle, fontSize: '0.8rem', width: '100%', maxWidth: '100%' })
                .child(buildModelSelectOptions(MODEL_CATALOG_FALLBACK.image, state.imageModel))
                .change(function() {
                  state.imageModel = this.value;
                  updateModelHints();
                  if (refs.headerModelLabel) {
                    refs.headerModelLabel.textContent = 'Model gambar: ' + getModelLabel(state.imageModel, 'image');
                  }
                }),
              el('div').link(refs, 'imageModelHint').css({ fontSize: '0.68rem', color: '#64748b', marginTop: '0.25rem', lineHeight: '1.35', wordBreak: 'break-word', whiteSpace: 'normal' })
            ])
          ]),
          el('div').link(refs, 'selectionSummary').text('Belum ada referensi dipilih').css({
            fontSize: '0.8rem',
            color: '#f59e0b',
            padding: '0.5rem 0.65rem',
            background: '#0f172a',
            borderRadius: '0.4rem',
            border: '1px solid #334155'
          }),
          el('div').child([
            el('div').text('Referensi terpilih').css({ fontSize: '0.75rem', fontWeight: '600', color: '#94a3b8', marginBottom: '0.4rem' }),
            el('div').link(refs, 'selectedChipsContainer').css({
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.4rem',
              minHeight: '2.25rem',
              padding: '0.5rem',
              background: '#0f172a',
              borderRadius: '0.5rem',
              border: '1px dashed #334155'
            })
          ]),
          el('div').css({
            padding: '0.75rem',
            background: '#0f172a',
            borderRadius: '0.5rem',
            border: '1px solid #334155'
          }).child([
            el('div').text('Panel Komik').css({
              fontSize: '0.75rem',
              fontWeight: '700',
              color: '#94a3b8',
              marginBottom: '0.6rem',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }),
            el('div').css({ marginBottom: '0.5rem' }).child([
              el('label').text('Gaya visual').css({ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }),
              el('select').link(refs, 'comicStyleSelect').css({ ...inputStyle, fontSize: '0.8rem' }).child([
                el('option').text('Manga (Jepang)').attr('value', 'manga'),
                el('option').text('Comic Book (Amerika)').attr('value', 'comic'),
                el('option').text('Manhwa (Korea)').attr('value', 'manhwa'),
                el('option').text('Webtoon').attr('value', 'webtoon')
              ]).change(function() {
                state.comicStyle = this.value;
              })
            ]),
            el('div').css({ marginBottom: '0.5rem' }).child([
              el('label').text('Sudut pandang').css({ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }),
              el('select').link(refs, 'cameraAngleSelect').css({ ...inputStyle, fontSize: '0.8rem' }).child([
                el('option').text('Otomatis (sesuai adegan)').attr('value', 'auto'),
                el('option').text('Close-up (wajah)').attr('value', 'close_up'),
                el('option').text('Medium shot (torso)').attr('value', 'medium'),
                el('option').text('Wide shot (seluruh tubuh)').attr('value', 'wide'),
                el('option').text('Bird\'s eye (dari atas)').attr('value', 'birds_eye'),
                el('option').text('Worm\'s eye (dari bawah)').attr('value', 'worms_eye'),
                el('option').text('Over-the-shoulder').attr('value', 'over_shoulder'),
                el('option').text('Dutch angle (miring)').attr('value', 'dutch'),
                el('option').text('Profil / samping').attr('value', 'profile')
              ]).change(function() {
                state.cameraAngle = this.value;
              })
            ]),
            el('div').css({ marginBottom: '0.5rem' }).child([
              el('label').text('Teks di panel').css({ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }),
              el('select').link(refs, 'speechModeSelect').css({ ...inputStyle, fontSize: '0.8rem' }).child([
                el('option').text('Otomatis (deteksi dari adegan)').attr('value', 'auto'),
                el('option').text('Dialog (speech bubble)').attr('value', 'dialogue'),
                el('option').text('Monolog (thought bubble)').attr('value', 'monologue'),
                el('option').text('Dialog + monolog').attr('value', 'both'),
                el('option').text('Tanpa teks di panel').attr('value', 'none')
              ]).change(function() {
                state.speechMode = this.value;
              })
            ]),
            el('div').css({ marginBottom: '0.5rem' }).child([
              el('label').text('Dialog (speech bubble)').css({ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }),
              el('input').link(refs, 'dialogueInput').attr('type', 'text').attr('placeholder', 'Opsional: "Aku bisa melawan ini!"').css({
                ...inputStyle,
                fontSize: '0.8rem'
              }).on('input', function(e) {
                state.dialogue = e.target.value;
              })
            ]),
            el('div').child([
              el('label').text('Narator (caption box)').css({ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginBottom: '0.25rem' }),
              el('input').link(refs, 'narratorInput').attr('type', 'text').attr('placeholder', 'Opsional: "Hari itu, Dina tidak menyangka..."').css({
                ...inputStyle,
                fontSize: '0.8rem'
              }).on('input', function(e) {
                state.narrator = e.target.value;
              })
            ])
          ]),
          el('div').child([
            el('div').css({
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.4rem',
              flexWrap: 'wrap'
            }).child([
              el('div').text('Prompt adegan').css({ fontSize: '0.75rem', fontWeight: '600', color: '#94a3b8' }),
              el('button')
                .attr('type', 'button')
                .link(refs, 'enhancePromptBtn')
                .css({
                  padding: '0.35rem 0.65rem',
                  background: '#4c1d95',
                  color: '#e9d5ff',
                  border: '1px solid #6d28d9',
                  borderRadius: '0.4rem',
                  cursor: 'pointer',
                  fontSize: '0.72rem',
                  fontWeight: '600',
                  whiteSpace: 'nowrap'
                })
                .child([
                  el('i').class('fas fa-wand-magic-sparkles').css({ marginRight: '0.35rem' }),
                  el('span').link(refs, 'enhancePromptLabel').text('Perhalus dengan AI')
                ])
                .click(enhanceScenePrompt)
            ]),
            el('div').text('Tulis ide singkat. AI akan memperhalus ke gaya komik/manga sesuai pengaturan panel di atas.').css({
              fontSize: '0.7rem',
              color: '#64748b',
              marginBottom: '0.4rem',
              lineHeight: '1.4'
            }),
            el('textarea').link(refs, 'promptInput').attr('rows', '8').attr('placeholder', 'Contoh: Luna terpojok, berkata "Aku tidak bisa kabur!" sambil berbicara dengan diri sendiri "Tenang... napas dulu."').css({
              width: '100%',
              minHeight: '180px',
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '0.5rem',
              padding: '0.75rem',
              fontSize: '0.9rem',
              color: '#e2e8f0',
              fontFamily: 'Roboto, sans-serif',
              resize: 'vertical',
              boxSizing: 'border-box',
              lineHeight: '1.5'
            }).on('input', function(e) {
              state.prompt = e.target.value;
            })
          ]),
          el('button').link(refs, 'generateBtn').text('Generate Comic').css({
            width: '100%',
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            padding: '0.85rem',
            cursor: 'pointer',
            fontWeight: '700',
            fontSize: '0.95rem',
            boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)'
          }).click(generateComic)
        ]),
        el('div').css({
          flex: '1',
          padding: '1.25rem',
          overflowY: 'auto',
          background: '#0f172a',
          minWidth: '0'
        }).child([
          el('div').text('Galeri Hasil').css({
            fontSize: '0.85rem',
            fontWeight: '700',
            color: '#94a3b8',
            marginBottom: '1rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }),
          el('div').link(refs, 'generatedImageContainer').css({
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '1rem'
          })
        ])
      ])
    ])
  ]);

  if (refs.comicStyleSelect) refs.comicStyleSelect.value = state.comicStyle;
  if (refs.cameraAngleSelect) refs.cameraAngleSelect.value = state.cameraAngle;

  renderModelSelects();
  fetchModelConfig();
  fetchReferences();
  fetchGenerations();
  renderSelectedChips();
  updateSelectionSummary();

  return page;
}

export function createSavedDataPage() {
  const refs = {};
  const state = {
    references: [],
    generations: [],
    refPage: 1,
    genPage: 1,
    pageSize: 20,
    activeTab: 'references'
  };

  async function loadData() {
    try {
      const [genRes, refRes] = await Promise.all([
        fetch(`${BACKEND_URL}/generations`),
        fetch(`${BACKEND_URL}/references`)
      ]);

      const genData = await genRes.json();
      const refData = await refRes.json();

      state.generations = genData.success ? genData.data : [];
      state.references = refData.success ? refData.data : [];

      renderContent();
      renderTabs();
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  }

  function switchTab(tab) {
    state.activeTab = tab;
    if (tab === 'references') state.refPage = 1;
    else state.genPage = 1;
    renderContent();
    renderTabs();
  }

  function renderContent() {
    if (state.activeTab === 'references') {
      renderReferencesTab();
    } else {
      renderGenerationsTab();
    }
  }

  function renderReferencesTab() {
    if (!refs.tabContent) return;

    const start = (state.refPage - 1) * state.pageSize;
    const end = start + state.pageSize;
    const pageData = state.references.slice(start, end);
    const totalPages = Math.ceil(state.references.length / state.pageSize);

    el(refs.tabContent).empty().child([
      // Table Header
      el('div').css({
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem'
      }).child([
        el('div').text(`References (${state.references.length})`).css({
          fontSize: '1.1rem',
          fontWeight: '700',
          color: '#e2e8f0'
        }),
        el('div').link(refs, 'refCount').css({
          fontSize: '0.85rem',
          color: '#94a3b8'
        })
      ]),

      // Table
      el('div').css({
        background: '#1e293b',
        borderRadius: '0.75rem',
        border: '1px solid #334155',
        overflow: 'hidden',
        marginBottom: '1rem'
      }).child([
        el('div').css({ overflowX: 'auto' }).child(
          el('table').css({ width: '100%', borderCollapse: 'collapse' }).child([
            el('thead').child(
              el('tr').css({ background: '#0f172a' }).child([
                el('th').text('Image').css({ padding: '0.75rem 1.25rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', width: '80px' }),
                el('th').text('Name').css({ padding: '0.75rem 1.25rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }),
                el('th').text('Type').css({ padding: '0.75rem 1.25rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', width: '120px' }),
                el('th').text('Created').css({ padding: '0.75rem 1.25rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', width: '180px' }),
                el('th').text('Actions').css({ padding: '0.75rem 1.25rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', width: '100px' })
              ])
            ),
            el('tbody').link(refs, 'refTableBody').child(
              pageData.length === 0
                ? el('tr').child(
                    el('td').attr('colspan', '5').css({ padding: '3rem', textAlign: 'center', color: '#64748b' }).child([
                      el('i').class('fas fa-image').css({ fontSize: '2rem', marginBottom: '0.75rem', display: 'block', color: '#475569' }),
                      el('div').text('Belum ada referensi'),
                      el('button').text('Buka Generator').css({
                        marginTop: '0.75rem',
                        padding: '0.5rem 1rem',
                        background: '#3b82f6',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '0.4rem',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: '600'
                      }).click(() => layout.navigate('/comic-generator'))
                    ])
                  )
                : pageData.map(ref =>
                    el('tr').css({ borderBottom: '1px solid #334155', transition: 'background 0.2s' })
                      .mouseover(function() { this.style.background = '#0f172a'; })
                      .mouseout(function() { this.style.background = 'transparent'; })
                      .child([
                      el('td').css({ padding: '0.75rem 1.25rem' }).child(
                        el('img').attr('src', toImageSrc(ref.image_base64)).css({ width: '48px', height: '48px', borderRadius: '0.5rem', objectFit: 'cover', border: '1px solid #334155' })
                      ),
                      el('td').css({ padding: '0.75rem 1.25rem' }).child(
                        el('div').text(ref.name).css({ fontWeight: '600', color: '#e2e8f0', fontSize: '0.9rem' })
                      ),
                      el('td').css({ padding: '0.75rem 1.25rem' }).child(
                        el('span').text(TYPE_LABELS[ref.type] || ref.type).css({
                          padding: '0.3rem 0.75rem',
                          borderRadius: '999px',
                          background: (TYPE_COLORS[ref.type] || '#64748b') + '30',
                          color: TYPE_COLORS[ref.type] || '#64748b',
                          fontSize: '0.7rem',
                          fontWeight: '600',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em'
                        })
                      ),
                      el('td').css({ padding: '0.75rem 1.25rem' }).child(
                        el('div').text(ref.created_at).css({ color: '#94a3b8', fontSize: '0.8rem' })
                      ),
                      el('td').css({ padding: '0.75rem 1.25rem' }).child(
                        el('button').css({
                          padding: '0.5rem 1rem',
                          background: '#7f1d1d',
                          color: '#fca5a5',
                          border: 'none',
                          borderRadius: '0.375rem',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          transition: 'all 0.2s'
                        })
                        .mouseover(function() { this.style.background = '#991b1b'; })
                        .mouseout(function() { this.style.background = '#7f1d1d'; })
                        .text('Delete')
                        .click(() => deleteReference(ref.id))
                      )
                    ])
                  )
            )
          ])
        )
      ]),

      // Pagination
      el('div').link(refs, 'refPagination').css({
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '0.5rem'
      })
    ]).get();

    renderPagination(refs.refPagination, state.refPage, totalPages, (page) => {
      state.refPage = page;
      renderReferencesTab();
    });

    if (refs.refCount) {
      refs.refCount.textContent = `Showing ${start + 1}-${Math.min(end, state.references.length)} of ${state.references.length}`;
    }
  }

  function renderGenerationsTab() {
    if (!refs.tabContent) return;

    const start = (state.genPage - 1) * state.pageSize;
    const end = start + state.pageSize;
    const pageData = state.generations.slice(start, end);
    const totalPages = Math.ceil(state.generations.length / state.pageSize);

    el(refs.tabContent).empty().child([
      // Table Header
      el('div').css({
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem'
      }).child([
        el('div').text(`Generations (${state.generations.length})`).css({
          fontSize: '1.1rem',
          fontWeight: '700',
          color: '#e2e8f0'
        }),
        el('div').link(refs, 'genCount').css({
          fontSize: '0.85rem',
          color: '#94a3b8'
        })
      ]),

      // Table
      el('div').css({
        background: '#1e293b',
        borderRadius: '0.75rem',
        border: '1px solid #334155',
        overflow: 'hidden',
        marginBottom: '1rem'
      }).child([
        el('div').css({ overflowX: 'auto' }).child(
          el('table').css({ width: '100%', borderCollapse: 'collapse' }).child([
            el('thead').child(
              el('tr').css({ background: '#0f172a' }).child([
                el('th').text('Preview').css({ padding: '0.75rem 1.25rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', width: '100px' }),
                el('th').text('Prompt').css({ padding: '0.75rem 1.25rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }),
                el('th').text('Refs').css({ padding: '0.75rem 1.25rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', width: '80px' }),
                el('th').text('Created').css({ padding: '0.75rem 1.25rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', width: '180px' }),
                el('th').text('Actions').css({ padding: '0.75rem 1.25rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', width: '150px' })
              ])
            ),
            el('tbody').link(refs, 'genTableBody').child(
              pageData.length === 0
                ? el('tr').child(
                    el('td').attr('colspan', '5').css({ padding: '3rem', textAlign: 'center', color: '#64748b' }).child([
                      el('i').class('fas fa-magic').css({ fontSize: '2rem', marginBottom: '0.75rem', display: 'block', color: '#475569' }),
                      el('div').text('Belum ada hasil generate'),
                      el('button').text('Buat Komik').css({
                        marginTop: '0.75rem',
                        padding: '0.5rem 1rem',
                        background: '#3b82f6',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '0.4rem',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: '600'
                      }).click(() => layout.navigate('/comic-generator'))
                    ])
                  )
                : pageData.map(gen => {
                    let refIds = [];
                    try {
                      refIds = JSON.parse(gen.reference_ids || '[]');
                    } catch (e) {
                      refIds = [];
                    }
                    return el('tr').css({ borderBottom: '1px solid #334155', transition: 'background 0.2s' })
                      .mouseover(function() { this.style.background = '#0f172a'; })
                      .mouseout(function() { this.style.background = 'transparent'; })
                      .child([
                      el('td').css({ padding: '0.75rem 1.25rem' }).child(
                        el('img').attr('src', toImageSrc(gen.image_base64)).css({ 
                          width: '64px', 
                          height: '64px', 
                          borderRadius: '0.5rem', 
                          objectFit: 'cover',
                          border: '1px solid #334155',
                          cursor: 'pointer'
                        }).click(() => viewGeneration(gen))
                      ),
                      el('td').css({ padding: '0.75rem 1.25rem', maxWidth: '400px' }).child([
                        el('div').text(gen.prompt).attr('title', gen.prompt).css({
                          color: '#e2e8f0',
                          fontSize: '0.85rem',
                          lineHeight: '1.5',
                          wordBreak: 'break-word',
                          whiteSpace: 'pre-wrap'
                        })
                      ]),
                      el('td').css({ padding: '0.75rem 1.25rem' }).child(
                        el('span').text(refIds.length).css({
                          padding: '0.3rem 0.75rem',
                          background: '#3b82f630',
                          color: '#3b82f6',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        })
                      ),
                      el('td').css({ padding: '0.75rem 1.25rem' }).child(
                        el('div').text(gen.created_at).css({ color: '#94a3b8', fontSize: '0.8rem' })
                      ),
                      el('td').css({ padding: '0.75rem 1.25rem' }).child([
                        el('button').css({
                          padding: '0.5rem 0.75rem',
                          background: '#1e293b',
                          color: '#e2e8f0',
                          border: '1px solid #334155',
                          borderRadius: '0.375rem',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          marginRight: '0.5rem',
                          transition: 'all 0.2s'
                        })
                        .mouseover(function() { this.style.background = '#334155'; })
                        .mouseout(function() { this.style.background = '#1e293b'; })
                        .text('View')
                        .click(() => viewGeneration(gen)),
                        el('button').css({
                          padding: '0.5rem 0.75rem',
                          background: '#7f1d1d',
                          color: '#fca5a5',
                          border: 'none',
                          borderRadius: '0.375rem',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          transition: 'all 0.2s'
                        })
                        .mouseover(function() { this.style.background = '#991b1b'; })
                        .mouseout(function() { this.style.background = '#7f1d1d'; })
                        .text('Delete')
                        .click(() => deleteGeneration(gen.id))
                      ])
                    ]);
                  })
            )
          ])
        )
      ]),

      // Pagination
      el('div').link(refs, 'genPagination').css({
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '0.5rem'
      })
    ]).get();

    renderPagination(refs.genPagination, state.genPage, totalPages, (page) => {
      state.genPage = page;
      renderGenerationsTab();
    });

    if (refs.genCount) {
      refs.genCount.textContent = `Showing ${start + 1}-${Math.min(end, state.generations.length)} of ${state.generations.length}`;
    }
  }

  function renderPagination(container, currentPage, totalPages, onPageChange) {
    if (!container) return;

    if (totalPages <= 1) {
      el(container).empty().get();
      return;
    }

    const buttons = [];

    // Prev button
    buttons.push(
      el('button').text('← Prev').css({
        padding: '0.6rem 1rem',
        background: currentPage === 1 ? '#0f172a' : '#1e293b',
        color: currentPage === 1 ? '#475569' : '#e2e8f0',
        border: '1px solid #334155',
        borderRadius: '0.5rem',
        cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
        fontSize: '0.85rem',
        fontWeight: '600',
        transition: 'all 0.2s'
      })
      .mouseover(function() { if (currentPage > 1) this.style.background = '#334155'; })
      .mouseout(function() { if (currentPage > 1) this.style.background = '#1e293b'; })
      .click(() => {
        if (currentPage > 1) onPageChange(currentPage - 1);
      })
    );

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
        buttons.push(
          el('button').text(i.toString()).css({
            padding: '0.6rem 0.85rem',
            background: i === currentPage ? '#3b82f6' : '#1e293b',
            color: i === currentPage ? '#fff' : '#e2e8f0',
            border: '1px solid ' + (i === currentPage ? '#3b82f6' : '#334155'),
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: i === currentPage ? '700' : '600',
            transition: 'all 0.2s'
          })
          .mouseover(function() { if (i !== currentPage) this.style.background = '#334155'; })
          .mouseout(function() { if (i !== currentPage) this.style.background = '#1e293b'; })
          .click(() => onPageChange(i))
        );
      } else if (i === currentPage - 2 || i === currentPage + 2) {
        buttons.push(
          el('span').text('...').css({ padding: '0.6rem', color: '#64748b' })
        );
      }
    }

    // Next button
    buttons.push(
      el('button').text('Next →').css({
        padding: '0.6rem 1rem',
        background: currentPage === totalPages ? '#0f172a' : '#1e293b',
        color: currentPage === totalPages ? '#475569' : '#e2e8f0',
        border: '1px solid #334155',
        borderRadius: '0.5rem',
        cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
        fontSize: '0.85rem',
        fontWeight: '600',
        transition: 'all 0.2s'
      })
      .mouseover(function() { if (currentPage < totalPages) this.style.background = '#334155'; })
      .mouseout(function() { if (currentPage < totalPages) this.style.background = '#1e293b'; })
      .click(() => {
        if (currentPage < totalPages) onPageChange(currentPage + 1);
      })
    );

    el(container).empty().child(buttons).get();
  }

  async function deleteReference(id) {
    layout.confirm({
      title: 'Delete Reference',
      message: 'Are you sure you want to delete this reference?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      onConfirm: async () => {
        try {
          await fetch(`${BACKEND_URL}/references/${id}`, { method: 'DELETE' });
          layout.toast('Reference deleted', { type: 'success' });
          loadData();
        } catch (error) {
          layout.toast('Failed to delete reference', { type: 'error' });
        }
      }
    });
  }

  async function deleteGeneration(id) {
    layout.confirm({
      title: 'Delete Generation',
      message: 'Are you sure you want to delete this generation?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      onConfirm: async () => {
        try {
          await fetch(`${BACKEND_URL}/generations/${id}`, { method: 'DELETE' });
          layout.toast('Generation deleted', { type: 'success' });
          loadData();
        } catch (error) {
          layout.toast('Failed to delete generation', { type: 'error' });
        }
      }
    });
  }

  function viewGeneration(gen) {
    const imageSrc = toImageSrc(gen.image_base64);
    layout.modal({
      title: 'Detail Generasi',
      size: 'large',
      content: el('div').css({ display: 'flex', flexDirection: 'column', gap: '1rem' }).child([
        el('div').css({
          padding: '1rem',
          background: '#0f172a',
          borderRadius: '0.5rem',
          border: '1px solid #334155'
        }).child([
          el('div').text('Prompt').css({
            fontSize: '0.75rem',
            fontWeight: '600',
            color: '#94a3b8',
            marginBottom: '0.5rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }),
          el('div').text(gen.prompt).css({
            fontSize: '0.9rem',
            color: '#e2e8f0',
            lineHeight: '1.6'
          })
        ]),
        el('img').attr('src', imageSrc).css({
          width: '100%',
          borderRadius: '0.5rem',
          border: '1px solid #334155'
        }),
        el('div').css({
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
          padding: '0.75rem 1rem',
          background: '#0f172a',
          borderRadius: '0.5rem',
          border: '1px solid #334155'
        }).child([
          el('div').text('Dibuat: ' + gen.created_at).css({ fontSize: '0.8rem', color: '#94a3b8' }),
          el('div').text(JSON.parse(gen.reference_ids || '[]').length + ' referensi dipakai').css({
            fontSize: '0.8rem',
            color: '#3b82f6',
            fontWeight: '600'
          })
        ])
      ]),
      buttons: [
        {
          text: 'Download',
          onClick: () => downloadImageFromSrc(imageSrc, `comic-gen-${gen.id}.png`)
        },
        { text: 'Tutup', onClick: () => {} }
      ]
    });
  }

  const page = el('div').css({
    width: '100%',
    height: 'calc(100dvh - 50px)',
    background: '#0f172a',
    color: '#e2e8f0',
    fontFamily: 'Roboto, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  }).child([
    // Header
    el('div').css({
      padding: '1.5rem',
      background: '#1e293b',
      borderBottom: '1px solid #334155',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexShrink: '0'
    }).child([
      el('div').child([
        el('div').text('Data Tersimpan').css({
          fontSize: '1.5rem',
          fontWeight: '700',
          color: '#e2e8f0',
          marginBottom: '0.25rem'
        }),
        el('div').text('Kelola referensi dan hasil generate Anda').css({
          color: '#94a3b8',
          fontSize: '0.85rem'
        })
      ]),
      el('button').css({
        padding: '0.6rem 1.25rem',
        background: '#3b82f6',
        color: '#fff',
        border: 'none',
        borderRadius: '0.5rem',
        cursor: 'pointer',
        fontSize: '0.85rem',
        fontWeight: '600',
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem'
      })
      .mouseover(function() { this.style.background = '#2563eb'; })
      .mouseout(function() { this.style.background = '#3b82f6'; })
      .child([
        el('i').class('fas fa-arrow-left'),
        el('span').text('Kembali ke Generator')
      ])
      .click(() => layout.navigate('/comic-generator'))
    ]),

    el('div').link(refs, 'tabBar').css({
      padding: '0 1.5rem',
      background: '#1e293b',
      borderBottom: '1px solid #334155',
      display: 'flex',
      gap: '0.5rem',
      flexShrink: '0',
      position: 'relative',
      zIndex: '2'
    }).child([
      el('button')
        .attr('type', 'button')
        .link(refs, 'tabReferencesBtn')
        .text('Referensi')
        .css({
          padding: '0.75rem 1.5rem',
          background: state.activeTab === 'references' ? '#3b82f6' : 'transparent',
          color: state.activeTab === 'references' ? '#fff' : '#94a3b8',
          border: 'none',
          borderBottom: state.activeTab === 'references' ? '2px solid #3b82f6' : '2px solid transparent',
          cursor: 'pointer',
          fontSize: '0.9rem',
          fontWeight: '600',
          transition: 'all 0.2s'
        })
        .click(() => switchTab('references')),
      el('button')
        .attr('type', 'button')
        .link(refs, 'tabGenerationsBtn')
        .text('Hasil Generate')
        .css({
          padding: '0.75rem 1.5rem',
          background: state.activeTab === 'generations' ? '#3b82f6' : 'transparent',
          color: state.activeTab === 'generations' ? '#fff' : '#94a3b8',
          border: 'none',
          borderBottom: state.activeTab === 'generations' ? '2px solid #3b82f6' : '2px solid transparent',
          cursor: 'pointer',
          fontSize: '0.9rem',
          fontWeight: '600',
          transition: 'all 0.2s'
        })
        .click(() => switchTab('generations'))
    ]),

    // Content Area
    el('div').css({
      flex: '1',
      padding: '1.5rem',
      overflow: 'auto'
    }).child([
      el('div').link(refs, 'tabContent')
    ])
  ]);

  function setTabButtonStyle(btn, isActive) {
    if (!btn) return;
    btn.style.background = isActive ? '#3b82f6' : 'transparent';
    btn.style.color = isActive ? '#fff' : '#94a3b8';
    btn.style.borderBottom = isActive ? '2px solid #3b82f6' : '2px solid transparent';
  }

  function renderTabs() {
    setTabButtonStyle(refs.tabReferencesBtn, state.activeTab === 'references');
    setTabButtonStyle(refs.tabGenerationsBtn, state.activeTab === 'generations');
  }

  loadData();

  return page;
}
