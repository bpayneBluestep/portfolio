(function () {
  // =========================================================
  // RESILIENT BOOT — polls until DOM + draft JSON are ready
  // =========================================================
  var BOOT_MAX_ATTEMPTS = 40;   // 40 × 50ms = up to 2 seconds
  var BOOT_INTERVAL_MS  = 50;
  var bootAttempts = 0;

  function domReady() {
    return !!(
      document.getElementById('bs-parent-app-builder-root') &&
      document.getElementById('bs-pab-canvas') &&
      document.getElementById('bs-pab-nav-list') &&
      document.getElementById('bs-pab-inspector')
    );
  }

  function tryBoot() {
    bootAttempts++;

    if (!domReady()) {
      if (bootAttempts < BOOT_MAX_ATTEMPTS) {
        setTimeout(tryBoot, BOOT_INTERVAL_MS);
      } else {
        console.error('[AppBuilder] DOM never became ready — aborting boot.');
      }
      return;
    }

    // DOM is ready — initialise
    initBuilder();
  }

  // Kick off polling immediately; also hook load event as a safety net
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryBoot);
  } else {
    tryBoot();
  }

  function initBuilder() {
    const root = document.getElementById('bs-parent-app-builder-root');
    if (!root) return;

    // =========================================================
    // CONFIG / BACKEND WIRING
    // =========================================================
    const facilityId = window.bsFacilityId || 'FACILITY_123';

    // Draft JSON may arrive late — read it now that we're booting
    const initialDraft = (function () {
      try {
        const raw = window.initialAppDraftJson
                 || window.initialParentAppDraftJson; // legacy alias
        if (!raw) return null;
        if (typeof raw === 'string') return JSON.parse(raw);
        if (typeof raw === 'object') return raw;
        return null;
      } catch (e) {
        console.warn('[AppBuilder] Invalid draft JSON', e);
        return null;
      }
    })();

    const SAVE_ENDPOINT    = '/data/applicationBuilder?action=save';
    const PUBLISH_ENDPOINT = '/data/applicationBuilder?action=publish';

    const MAP_TO_OPTIONS = [
      { value: '', label: '— Not mapped —' },
      { value: 'name.firstName',              label: 'Name & Email • Client First Name' },
      { value: 'name.lastName',               label: 'Name & Email • Client Last Name' },
      { value: 'name.email',                  label: 'Name & Email • Client Email' },
      { value: 'demographics.dob',            label: 'Demographics • Date of Birth' },
      { value: 'demographics.sex',            label: 'Demographics • Sex' },
      { value: 'demographics.gender',         label: 'Demographics • Gender' },
      { value: 'demographics.pronouns',       label: 'Demographics • Pronouns' },
      { value: 'demographics.race',           label: 'Demographics • Race' },
      { value: 'demographics.ethnicity',      label: 'Demographics • Ethnicity' },
      { value: 'demographics.sexualOrientation', label: 'Demographics • Sexual Orientation' },
      { value: 'demographics.ssn',            label: 'Demographics • Social Security Number' },
      { value: 'contact.address',             label: 'Contact Information • Address' },
      { value: 'contact.city',                label: 'Contact Information • City' },
      { value: 'contact.state',               label: 'Contact Information • State' },
      { value: 'contact.zip',                 label: 'Contact Information • Zip Code' },
      { value: 'contact.cellPhone',           label: 'Contact Information • Cell Phone' },
      { value: 'contact.homePhone',           label: 'Contact Information • Home Phone' }
    ];

    // =========================================================
    // STATE
    // =========================================================
    const state = {
      draft: initialDraft || {
        schemaVersion: 1,
        formType: 'application',
        facilityId: facilityId,
        title: 'Application',
        description: '',
        lastModifiedUtc: new Date().toISOString(),
        fields: []
      },
      selectedFieldId: null,
      draggingFieldId: null,
      draggingNewType: null,
      collapsedSections: new Set(),   // Set of header field IDs
      navCollapsedSections: new Set(),
      canvasFilter: '',
      navFilter: '',
      compactView: false,
      inspectorOpen: false
    };

    if (!state.draft.strings) state.draft.strings = {};

    // =========================================================
    // UTILITIES
    // =========================================================
    function generateUuid() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
    }

    function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

    function updateLastModified() {
      state.draft.lastModifiedUtc = new Date().toISOString();
    }

    function getFieldById(id) {
      return state.draft.fields.find(f => f.id === id) || null;
    }

    function ensureSelectedField() {
      if (!state.selectedFieldId && state.draft.fields.length > 0) {
        const first = state.draft.fields.find(f => f.type !== 'header' && f.type !== 'static_text');
        state.selectedFieldId = (first || state.draft.fields[0]).id;
      }
    }

    function fieldTypeLabel(type) {
      const map = {
        header: 'Header', static_text: 'Static', text: 'Text',
        memo: 'Memo', number: 'Number', date: 'Date',
        single_select: 'Single', multi_select: 'Multi', boolean: 'Yes/No',
        doc_upload: 'Upload'
      };
      return map[type] || type;
    }

    function fieldPreviewLabel(field) {
      if (field.type === 'header') return field.label || 'Untitled Section';
      if (field.type === 'static_text') return (field.settings.content || 'Static text').slice(0, 60);
      return field.label || 'Untitled question';
    }

    function getLogicEligibleSourceFields() {
      const allowed = new Set(['boolean', 'single_select', 'multi_select']);
      return (state.draft.fields || []).filter(f => allowed.has(f.type));
    }

    function getFieldLabelForLogic(field) {
      if (!field) return '(Unknown field)';
      return field.label || '(Untitled)';
    }

    function summarizeVisibilityRule(rule) {
      if (!rule || !rule.sourceFieldId || !rule.match) return '';
      const src = getFieldById(rule.sourceFieldId);
      if (!src) return 'Conditional';
      const srcLabel = getFieldLabelForLogic(src);

      if (src.type === 'boolean') {
        const t = !!(rule.match.boolean && rule.match.boolean.true);
        const f = !!(rule.match.boolean && rule.match.boolean.false);
        if (t && f) return `Shown when ${srcLabel} = Yes or No`;
        if (t) return `Shown when ${srcLabel} = Yes`;
        if (f) return `Shown when ${srcLabel} = No`;
        return `Conditional on ${srcLabel}`;
      }

      const ids = Array.isArray(rule.match.optionIds) ? rule.match.optionIds : [];
      if (!ids.length) return `Conditional on ${srcLabel}`;
      const options = src.settings && Array.isArray(src.settings.options) ? src.settings.options : [];
      const labels = ids.map(id => (options.find(o => o.id === id) || {}).label).filter(Boolean);
      if (!labels.length) return `Conditional on ${srcLabel}`;
      const display = labels.length > 2 ? labels.slice(0, 2).join(', ') + ` +${labels.length - 2}` : labels.join(', ');
      return `Shown when ${srcLabel} = ${display}`;
    }

    function clearDropIndicators() {
      root.querySelectorAll('.bs-pab-drop-before, .bs-pab-drop-after').forEach(el => {
        el.classList.remove('bs-pab-drop-before', 'bs-pab-drop-after');
      });
    }

    function createEmptyField(type) {
      const id = generateUuid();
      const base = { id, type, label: '', description: '', required: false, mapTo: '', active: true, settings: {} };
      if (type === 'header') {
        base.label = 'New Section';
        base.settings.repeatable = false;
        base.settings.entryLabel = '';
        base.settings.minEntries = 0;
        base.settings.maxEntries = null;
      }
      if (type === 'static_text') base.settings.content = 'Enter instructions here.';
      if (type === 'text') { base.settings.maxLength = 255; base.settings.placeholder = ''; base.settings.formatter = ''; }
      if (type === 'memo') { base.settings.maxLength = 2000; base.settings.placeholder = ''; }
      if (type === 'number') { base.settings.min = null; base.settings.max = null; }
      if (type === 'date') { base.settings.minDate = null; base.settings.maxDate = null; }
      if (type === 'single_select' || type === 'multi_select') {
        base.settings.options = [
          { id: generateUuid(), label: 'Option 1', active: true },
          { id: generateUuid(), label: 'Option 2', active: true }
        ];
      }
      if (type === 'boolean') { base.settings.trueLabel = 'Yes'; base.settings.falseLabel = 'No'; }
      if (type === 'doc_upload') { base.settings.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx'; base.settings.maxSizeMb = 10; }
      return base;
    }

    // Group fields into sections for rendering
    function groupFieldsIntoSections(fields) {
      const sections = [];
      let current = null;

      fields.forEach((field, idx) => {
        if (field.type === 'header') {
          current = { header: field, fields: [], index: idx };
          sections.push(current);
        } else {
          if (!current) {
            current = { header: null, fields: [], index: -1 };
            sections.push(current);
          }
          current.fields.push({ field, index: idx });
        }
      });

      return sections;
    }

    // =========================================================
    // STATUS BAR
    // =========================================================
    function renderStatusBar() {
      const fields = state.draft.fields || [];
      const questions = fields.filter(f => f.type !== 'header' && f.type !== 'static_text');
      const total = fields.length;
      const unmapped = questions.filter(f => !f.mapTo).length;
      const required = questions.filter(f => f.required).length;
      const conditional = fields.filter(f => f.visibilityRule && f.visibilityRule.sourceFieldId).length;
      const inactive = fields.filter(f => !f.active).length;

      document.getElementById('stat-total').querySelector('.bs-pab-stat-num').textContent = total;
      document.getElementById('stat-unmapped').querySelector('.bs-pab-stat-num').textContent = unmapped;
      document.getElementById('stat-required').querySelector('.bs-pab-stat-num').textContent = required;
      document.getElementById('stat-conditional').querySelector('.bs-pab-stat-num').textContent = conditional;
      document.getElementById('stat-inactive').querySelector('.bs-pab-stat-num').textContent = inactive;

      const unmappedStat = document.getElementById('stat-unmapped');
      unmappedStat.classList.toggle('bs-pab-stat-warn', unmapped > 0);
    }

    // =========================================================
    // NAVIGATOR (LEFT)
    // =========================================================
    function renderNavigator() {
      const navList = document.getElementById('bs-pab-nav-list');
      navList.innerHTML = '';

      const filter = state.navFilter.toLowerCase().trim();
      const sections = groupFieldsIntoSections(state.draft.fields || []);

      sections.forEach(section => {
        const isOrphan = !section.header;
        const sectionId = section.header ? section.header.id : '__orphan__';
        const sectionLabel = section.header ? (section.header.label || 'Untitled Section') : 'Ungrouped';
        const isCollapsed = state.navCollapsedSections.has(sectionId);

        // Filter matching children
        const matchingChildren = section.fields.filter(({ field }) => {
          if (!filter) return true;
          const label = fieldPreviewLabel(field).toLowerCase();
          return label.includes(filter);
        });

        // Also check if header label matches
        const headerMatches = !filter || sectionLabel.toLowerCase().includes(filter);

        if (filter && !headerMatches && matchingChildren.length === 0) return;

        const sectionEl = document.createElement('div');
        sectionEl.className = 'bs-pab-nav-section';

        if (!isOrphan) {
          // Section header
          const headerEl = document.createElement('div');
          headerEl.className = 'bs-pab-nav-section-header' + (isCollapsed ? ' collapsed' : '');

          const navRepIcon = section.header && section.header.settings && section.header.settings.repeatable
            ? '<span class="bs-pab-nav-repeatable-icon" title="Repeatable section">↻</span>'
            : '';
          headerEl.innerHTML = `
            <span class="bs-pab-nav-section-arrow">▼</span>
            <span class="bs-pab-nav-section-label">${escHtml(sectionLabel)}</span>
            ${navRepIcon}
            <span class="bs-pab-nav-section-count">${matchingChildren.length || section.fields.length}</span>
          `;

          headerEl.addEventListener('click', () => {
            if (state.navCollapsedSections.has(sectionId)) {
              state.navCollapsedSections.delete(sectionId);
            } else {
              state.navCollapsedSections.add(sectionId);
            }
            renderNavigator();
          });

          // Click the label to select the header field
          headerEl.querySelector('.bs-pab-nav-section-label').addEventListener('click', (e) => {
            e.stopPropagation();
            selectField(section.header.id);
          });

          sectionEl.appendChild(headerEl);
        }

        // Children
        const childrenEl = document.createElement('div');
        childrenEl.className = 'bs-pab-nav-items' + (isCollapsed && !isOrphan ? ' collapsed' : '');

        const childrenToShow = filter ? matchingChildren : section.fields;
        childrenToShow.forEach(({ field }) => {
          if (field.type === 'header') return;
          const itemEl = document.createElement('div');
          itemEl.className = 'bs-pab-nav-item' +
            (state.selectedFieldId === field.id ? ' active' : '') +
            (field.required ? ' bs-pab-nav-item-req' : '');
          itemEl.innerHTML = `
            <div class="bs-pab-nav-item-dot"></div>
            <span class="bs-pab-nav-item-label">${escHtml(fieldPreviewLabel(field))}</span>
            <span class="bs-pab-nav-item-type">${fieldTypeLabel(field.type)}</span>
          `;
          itemEl.addEventListener('click', () => selectField(field.id));
          childrenEl.appendChild(itemEl);
        });

        sectionEl.appendChild(childrenEl);
        navList.appendChild(sectionEl);
      });
    }

    // =========================================================
    // CANVAS
    // =========================================================
    const canvasEl = document.getElementById('bs-pab-canvas');

    // Allow dropping new type into empty canvas area
    canvasEl.addEventListener('dragover', (e) => {
      if (!state.draggingNewType) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    canvasEl.addEventListener('drop', (e) => {
      if (!state.draggingNewType) return;
      e.preventDefault();
      const newField = createEmptyField(state.draggingNewType);
      state.draft.fields.push(newField);
      state.selectedFieldId = newField.id;
      state.draggingNewType = null;
      updateLastModified();
      renderAll();
    });

    function renderCanvas() {
      canvasEl.innerHTML = '';

      if (state.compactView) {
        canvasEl.classList.add('compact');
      } else {
        canvasEl.classList.remove('compact');
      }

      const fields = state.draft.fields || [];

      if (fields.length === 0) {
        canvasEl.innerHTML = `
          <div class="bs-pab-empty-state">
            <strong>No fields yet</strong>
            Click <em>Add Field</em> in the navigator to get started, or use the button above.
          </div>`;
        return;
      }

      const filter = state.canvasFilter.toLowerCase().trim();
      const sections = groupFieldsIntoSections(fields);

      sections.forEach(section => {
        const sectionId = section.header ? section.header.id : '__orphan__';
        const isCollapsed = state.collapsedSections.has(sectionId);

        const filteredChildren = section.fields.filter(({ field }) => {
          if (!filter) return true;
          return fieldPreviewLabel(field).toLowerCase().includes(filter);
        });

        const headerMatchesFilter = !filter || (section.header && (section.header.label || '').toLowerCase().includes(filter));
        if (filter && !headerMatchesFilter && filteredChildren.length === 0) return;

        const sectionGroup = document.createElement('div');
        sectionGroup.className = 'bs-pab-section-group';

        // --- Render header card ---
        if (section.header) {
          const hField = section.header;
          const hCard = buildSectionHeaderCard(hField, filteredChildren.length || section.fields.length, isCollapsed);
          sectionGroup.appendChild(hCard);
        }

        // --- Render children ---
        const sectionBody = document.createElement('div');
        sectionBody.className = 'bs-pab-section-body' + (isCollapsed ? ' collapsed' : '');

        const fieldList = document.createElement('div');
        fieldList.className = 'bs-pab-field-list';

        const childrenToRender = filter ? filteredChildren : section.fields;
        childrenToRender.forEach(({ field, index }) => {
          const card = buildFieldCard(field, index);
          fieldList.appendChild(card);
        });

        sectionBody.appendChild(fieldList);
        sectionGroup.appendChild(sectionBody);
        canvasEl.appendChild(sectionGroup);
      });
    }

    function buildSectionHeaderCard(field, childCount, isCollapsed) {
      const card = document.createElement('div');
      card.className = 'bs-pab-section-header-card' +
        (state.selectedFieldId === field.id ? ' bs-pab-field-selected' : '') +
        (field.settings && field.settings.repeatable ? ' bs-pab-section-repeatable' : '');
      card.setAttribute('draggable', 'true');
      card.dataset.fieldId = field.id;

      const repSettings = field.settings || {};
      const repBadgeHtml = repSettings.repeatable
        ? `<span class="bs-pab-section-repeatable-badge" title="Repeatable section — applicants can add multiple entries">↻ ${escHtml(repSettings.entryLabel || 'Entry')}</span>`
        : '';
      card.innerHTML = `
        <button class="bs-pab-section-collapse-btn${isCollapsed ? ' collapsed' : ''}" title="Toggle section" data-section-toggle="${field.id}">▼</button>
        <span class="bs-pab-section-drag-handle" title="Drag to reorder">⠿</span>
        <span class="bs-pab-section-label">${escHtml(field.label || 'Untitled Section')}</span>
        ${repBadgeHtml}
        <span class="bs-pab-section-meta">${childCount} field${childCount !== 1 ? 's' : ''}</span>
        <div class="bs-pab-section-field-actions">
          <button class="bs-pab-icon-btn" data-action="duplicate" title="Duplicate">⧉</button>
          <button class="bs-pab-icon-btn bs-pab-icon-btn-danger" data-action="delete" title="Delete section">🗑</button>
        </div>
      `;

      // Collapse toggle
      card.querySelector('[data-section-toggle]').addEventListener('click', (e) => {
        e.stopPropagation();
        const sectionId = field.id;
        if (state.collapsedSections.has(sectionId)) {
          state.collapsedSections.delete(sectionId);
        } else {
          state.collapsedSections.add(sectionId);
        }
        renderCanvas();
        renderNavigator();
      });

      // Click to select + open inspector
      card.addEventListener('click', (e) => {
        if (e.target.closest('.bs-pab-section-field-actions') || e.target.closest('[data-section-toggle]')) return;
        state.inspectorOpen = true;
        document.querySelector('.bs-pab-body').classList.add('inspector-open');
        selectField(field.id);
      });

      // Duplicate
      card.querySelector('[data-action="duplicate"]').addEventListener('click', (e) => {
        e.stopPropagation();
        duplicateField(field.id);
      });

      // Delete
      card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteField(field.id);
      });

      // Drag events
      setupFieldDrag(card, field);

      return card;
    }

    function buildFieldCard(field, index) {
      const isSelected = state.selectedFieldId === field.id;

      const card = document.createElement('div');
      card.className = 'bs-pab-field-card' +
        (isSelected ? ' bs-pab-field-selected' : '') +
        (!field.active ? ' bs-pab-field-inactive' : '');
      card.setAttribute('draggable', 'true');
      card.dataset.fieldId = field.id;

      // --- Closed row ---
      const row = document.createElement('div');
      row.className = 'bs-pab-field-row';

      // Handle
      const handle = document.createElement('div');
      handle.className = 'bs-pab-field-handle';
      handle.innerHTML = `
        <div class="bs-pab-handle-line"></div>
        <div class="bs-pab-handle-line"></div>
        <div class="bs-pab-handle-line"></div>
      `;

      // Type pill
      const typePill = document.createElement('span');
      typePill.className = `bs-pab-field-type-pill bs-pab-type-${field.type}`;
      typePill.textContent = fieldTypeLabel(field.type);

      // Main content
      const main = document.createElement('div');
      main.className = 'bs-pab-field-main';

      const labelText = document.createElement('div');
      labelText.className = 'bs-pab-field-label-text';
      labelText.textContent = fieldPreviewLabel(field);

      const hint = document.createElement('div');
      hint.className = 'bs-pab-field-hint';

      if (!field.active) {
        hint.textContent = 'Hidden — kept for historical data';
      } else if (field.visibilityRule && field.visibilityRule.sourceFieldId) {
        hint.textContent = summarizeVisibilityRule(field.visibilityRule);
      } else if (field.mapTo) {
        hint.textContent = MAP_TO_OPTIONS.find(o => o.value === field.mapTo)?.label || field.mapTo;
      } else if (field.type !== 'static_text') {
        hint.textContent = 'Not mapped';
      }

      main.appendChild(labelText);
      main.appendChild(hint);

      // Badges
      const badges = document.createElement('div');
      badges.className = 'bs-pab-field-badges';
      if (field.required) {
        const b = document.createElement('span');
        b.className = 'bs-pab-badge-pill bs-pab-badge-req';
        b.textContent = 'Req';
        badges.appendChild(b);
      }
      if (field.visibilityRule && field.visibilityRule.sourceFieldId) {
        const b = document.createElement('span');
        b.className = 'bs-pab-badge-pill bs-pab-badge-cond';
        b.textContent = 'Cond';
        badges.appendChild(b);
      }
      if (field.mapTo) {
        const b = document.createElement('span');
        b.className = 'bs-pab-badge-pill bs-pab-badge-mapped';
        b.textContent = 'Mapped';
        badges.appendChild(b);
      }
      if (!field.active) {
        const b = document.createElement('span');
        b.className = 'bs-pab-badge-pill bs-pab-badge-inactive';
        b.textContent = 'Off';
        badges.appendChild(b);
      }

      // Row actions
      const rowActions = document.createElement('div');
      rowActions.className = 'bs-pab-field-row-actions';

      const dupBtn = document.createElement('button');
      dupBtn.className = 'bs-pab-icon-btn';
      dupBtn.title = 'Duplicate';
      dupBtn.textContent = '⧉';
      dupBtn.addEventListener('click', (e) => { e.stopPropagation(); duplicateField(field.id); });

      const delBtn = document.createElement('button');
      delBtn.className = 'bs-pab-icon-btn bs-pab-icon-btn-danger';
      delBtn.title = 'Delete';
      delBtn.textContent = '🗑';
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteField(field.id); });

      rowActions.appendChild(dupBtn);
      rowActions.appendChild(delBtn);

      row.appendChild(handle);
      row.appendChild(typePill);
      row.appendChild(main);
      row.appendChild(badges);
      row.appendChild(rowActions);
      card.appendChild(row);

      // --- Inline editor (shown when selected) ---
      if (isSelected) {
        const inlineEditor = buildInlineEditor(field);
        card.appendChild(inlineEditor);
      }

      // Click to select
      card.addEventListener('click', (e) => {
        if (e.target.closest('.bs-pab-field-row-actions')) return;
        if (e.target.closest('.bs-pab-inline-editor')) return;
        if (state.selectedFieldId !== field.id) {
          selectField(field.id);
        }
      });

      setupFieldDrag(card, field);
      return card;
    }

    function buildInlineEditor(field) {
      const editor = document.createElement('div');
      editor.className = 'bs-pab-inline-editor';

      const row1 = document.createElement('div');
      row1.className = 'bs-pab-inline-row';

      // Label / content
      if (field.type === 'static_text') {
        const g = makeInlineGroup('Instructions text', 'flex', field.settings.content || '', 'textarea', (val) => {
          field.settings.content = val;
          updateLastModified();
          // Targeted update — don't rebuild canvas and lose focus
          const card = canvasEl.querySelector(`[data-field-id="${field.id}"]`);
          if (card) {
            const labelEl = card.querySelector('.bs-pab-field-label-text');
            if (labelEl) labelEl.textContent = fieldPreviewLabel(field);
          }
          renderNavigator();
        });
        row1.appendChild(g);
      } else {
        const g = makeInlineGroup(
          field.type === 'header' ? 'Section title' : 'Question label',
          'flex', field.label || '', 'input', (val) => {
            field.label = val;
            updateLastModified();
            // Targeted update — don't rebuild canvas and lose focus
            const card = canvasEl.querySelector(`[data-field-id="${field.id}"]`);
            if (card) {
              const labelEl = card.querySelector('.bs-pab-field-label-text');
              if (labelEl) labelEl.textContent = fieldPreviewLabel(field);
              // Also update section header label if it's a header type
              const sectionLabelEl = card.querySelector('.bs-pab-section-label');
              if (sectionLabelEl) sectionLabelEl.textContent = val || 'Untitled Section';
            }
            renderNavigator();
          }
        );
        row1.appendChild(g);
      }

      // Map to (for mappable fields)
      if (field.type !== 'header' && field.type !== 'static_text') {
        const mapG = document.createElement('div');
        mapG.className = 'bs-pab-inline-group bs-pab-inline-group-fixed';
        mapG.style.minWidth = '180px';
        mapG.style.flex = '0 0 180px';
        const lbl = document.createElement('div');
        lbl.className = 'bs-pab-inline-label';
        lbl.textContent = 'Map to';
        const sel = document.createElement('select');
        sel.className = 'bs-pab-inline-select';
        MAP_TO_OPTIONS.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          if ((field.mapTo || '') === opt.value) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', (e) => {
          field.mapTo = e.target.value || '';
          updateLastModified();
          renderCanvas();
          renderStatusBar();
        });
        mapG.appendChild(lbl);
        mapG.appendChild(sel);
        row1.appendChild(mapG);
      }

      editor.appendChild(row1);

      // Toggles row
      if (field.type !== 'header' && field.type !== 'static_text') {
        const toggleRow = document.createElement('div');
        toggleRow.className = 'bs-pab-inline-toggles';

        // Required toggle
        const reqItem = makeInlineToggle('Required', field.required, (val) => {
          field.required = val;
          updateLastModified();
          renderCanvas();
          renderStatusBar();
        });
        toggleRow.appendChild(reqItem);

        // Active toggle
        const activeItem = makeInlineToggle('Active', field.active, (val) => {
          field.active = val;
          updateLastModified();
          renderCanvas();
          renderStatusBar();
        });
        toggleRow.appendChild(activeItem);

        editor.appendChild(toggleRow);
      } else if (field.type === 'header') {
        // Active toggle for headers too
        const toggleRow = document.createElement('div');
        toggleRow.className = 'bs-pab-inline-toggles';
        const activeItem = makeInlineToggle('Active', field.active, (val) => {
          field.active = val;
          updateLastModified();
          renderCanvas();
          renderStatusBar();
        });
        toggleRow.appendChild(activeItem);
        editor.appendChild(toggleRow);
      }

      // "More settings" link → opens right inspector
      const moreBtn = document.createElement('button');
      moreBtn.className = 'bs-pab-inline-more-btn';
      moreBtn.textContent = 'More settings (description, logic, type options) →';
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openInspector(field.id);
      });
      editor.appendChild(moreBtn);

      return editor;
    }

    function makeInlineGroup(label, flex, value, inputType, onChange) {
      const g = document.createElement('div');
      g.className = 'bs-pab-inline-group' + (flex === 'flex' ? ' bs-pab-inline-group-flex' : ' bs-pab-inline-group-fixed');

      const lbl = document.createElement('div');
      lbl.className = 'bs-pab-inline-label';
      lbl.textContent = label;

      let input;
      if (inputType === 'textarea') {
        input = document.createElement('textarea');
        input.className = 'bs-pab-inline-input';
        input.style.minHeight = '52px';
        input.style.resize = 'vertical';
        input.value = value;
        input.addEventListener('input', (e) => onChange(e.target.value));
      } else {
        input = document.createElement('input');
        input.className = 'bs-pab-inline-input';
        input.value = value;
        input.addEventListener('input', (e) => onChange(e.target.value));
      }

      g.appendChild(lbl);
      g.appendChild(input);
      return g;
    }

    function makeInlineToggle(label, isOn, onChange) {
      const wrap = document.createElement('div');
      wrap.className = 'bs-pab-inline-toggle-item';

      const pill = document.createElement('div');
      pill.className = 'bs-pab-toggle-pill' + (isOn ? ' bs-pab-toggle-on' : '');

      const lbl = document.createElement('span');
      lbl.className = 'bs-pab-toggle-label';
      lbl.textContent = label;

      let current = isOn;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        current = !current;
        pill.classList.toggle('bs-pab-toggle-on', current);
        onChange(current);
      });
      lbl.addEventListener('click', (e) => {
        e.stopPropagation();
        current = !current;
        pill.classList.toggle('bs-pab-toggle-on', current);
        onChange(current);
      });

      wrap.appendChild(pill);
      wrap.appendChild(lbl);
      return wrap;
    }

    // =========================================================
    // DRAG AND DROP
    // =========================================================
    function setupFieldDrag(cardEl, field) {
      cardEl.addEventListener('dragstart', (e) => {
        state.draggingFieldId = field.id;
        state.draggingNewType = null;
        e.dataTransfer.effectAllowed = 'move';
      });

      cardEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        clearDropIndicators();
        const rect = cardEl.getBoundingClientRect();
        const isAfter = (e.clientY - rect.top) > rect.height / 2;
        cardEl.classList.toggle('bs-pab-drop-before', !isAfter);
        cardEl.classList.toggle('bs-pab-drop-after', isAfter);
        e.dataTransfer.dropEffect = state.draggingNewType ? 'copy' : 'move';
      });

      cardEl.addEventListener('drop', (e) => {
        e.preventDefault();
        clearDropIndicators();

        const rect = cardEl.getBoundingClientRect();
        const isAfter = (e.clientY - rect.top) > rect.height / 2;
        const toIndex = state.draft.fields.findIndex(f => f.id === field.id);
        if (toIndex === -1) return;
        let insertIndex = isAfter ? toIndex + 1 : toIndex;

        if (state.draggingNewType) {
          const newField = createEmptyField(state.draggingNewType);
          const updated = clone(state.draft.fields);
          updated.splice(insertIndex, 0, newField);
          state.draft.fields = updated;
          state.selectedFieldId = newField.id;
          state.draggingNewType = null;
          updateLastModified();
          renderAll();
          return;
        }

        const fromId = state.draggingFieldId;
        if (!fromId || fromId === field.id) return;
        const fromIndex = state.draft.fields.findIndex(f => f.id === fromId);
        if (fromIndex === -1) return;

        const updated = clone(state.draft.fields);
        const [moved] = updated.splice(fromIndex, 1);
        if (fromIndex < insertIndex) insertIndex -= 1;
        updated.splice(insertIndex, 0, moved);
        state.draft.fields = updated;
        state.draggingFieldId = null;
        updateLastModified();
        renderAll();
      });

      cardEl.addEventListener('dragend', () => {
        state.draggingFieldId = null;
        clearDropIndicators();
      });
    }

    // =========================================================
    // FIELD ACTIONS
    // =========================================================
    function selectField(id) {
      state.selectedFieldId = id;
      renderCanvas();
      renderNavigator();
      renderInspector();

      // Scroll field into view
      setTimeout(() => {
        const el = canvasEl.querySelector(`[data-field-id="${id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }

    function deleteField(id) {
      const idx = state.draft.fields.findIndex(f => f.id === id);
      if (idx === -1) return;
      const updated = clone(state.draft.fields);
      updated.splice(idx, 1);
      state.draft.fields = updated;
      if (state.selectedFieldId === id) {
        state.selectedFieldId = null;
        ensureSelectedField();
      }
      updateLastModified();
      renderAll();
    }

    function duplicateField(id) {
      const field = getFieldById(id);
      if (!field) return;
      const copy = clone(field);
      copy.id = generateUuid();
      if (copy.settings && Array.isArray(copy.settings.options)) {
        copy.settings.options = copy.settings.options.map(opt => ({
          id: generateUuid(), label: opt.label, active: opt.active
        }));
      }
      const idx = state.draft.fields.findIndex(f => f.id === id);
      const updated = clone(state.draft.fields);
      updated.splice(idx + 1, 0, copy);
      state.draft.fields = updated;
      state.selectedFieldId = copy.id;
      updateLastModified();
      renderAll();
    }

    // =========================================================
    // ADVANCED SETTINGS MODAL
    // =========================================================
    function renderAdvancedSettings() {
      const body = document.getElementById('bs-pab-adv-settings-body');
      body.innerHTML = '';

      const fieldDefs = [
        {
          label: 'Application Title',
          hint: 'Leave blank to show "Application"',
          get: () => state.draft.title || '',
          set: val => {
            state.draft.title = val;
            document.getElementById('bs-pab-form-title-display').textContent = val || 'Application Builder';
            updateLastModified();
          }
        },
        {
          label: 'Subtitle / Description',
          hint: 'Shown below the title on the form. Leave blank to hide.',
          get: () => state.draft.description || '',
          set: val => { state.draft.description = val; updateLastModified(); }
        },
        {
          label: 'Submitted Message',
          hint: 'Shown on the confirmation screen after submit.',
          placeholder: 'Thank you for your submission.',
          get: () => state.draft.strings.submittedMessage || '',
          set: val => { state.draft.strings.submittedMessage = val || null; updateLastModified(); }
        },
        {
          label: 'Completed Detail Message',
          hint: 'Detail text shown when applicant has already submitted.',
          placeholder: 'If you believe you need to make changes or resubmit information, please contact your admissions or intake team directly.',
          get: () => state.draft.strings.completedDetailMessage || '',
          set: val => { state.draft.strings.completedDetailMessage = val || null; updateLastModified(); }
        },
        {
          label: 'Expired Detail Message',
          hint: 'Detail text shown when the application is expired or closed.',
          placeholder: 'Online submission is not available at this time. If you have questions about the status of this application, please contact your admissions or intake team.',
          get: () => state.draft.strings.expiredDetailMessage || '',
          set: val => { state.draft.strings.expiredDetailMessage = val || null; updateLastModified(); }
        }
      ];

      fieldDefs.forEach(({ label, hint, placeholder, get, set }) => {
        const row = document.createElement('div');

        const lbl = document.createElement('label');
        lbl.className = 'bs-pab-insp-label';
        lbl.textContent = label;

        const ta = document.createElement('textarea');
        ta.className = 'bs-pab-insp-input';
        ta.style.cssText = 'min-height:60px;resize:vertical;width:100%';
        ta.value = get();
        if (placeholder) ta.placeholder = placeholder;
        ta.addEventListener('input', () => set(ta.value.trim()));

        const hintEl = document.createElement('p');
        hintEl.style.cssText = 'font-size:11px;color:#9ca3af;margin:2px 0 0';
        hintEl.textContent = hint;

        row.appendChild(lbl);
        row.appendChild(ta);
        row.appendChild(hintEl);
        body.appendChild(row);
      });
    }

    // =========================================================
    // INSPECTOR (RIGHT PANEL — full settings)
    // =========================================================
    function openInspector(fieldId) {
      if (fieldId) state.selectedFieldId = fieldId;
      state.inspectorOpen = true;
      document.querySelector('.bs-pab-body').classList.add('inspector-open');
      renderInspector();
    }

    function closeInspector() {
      state.inspectorOpen = false;
      document.querySelector('.bs-pab-body').classList.remove('inspector-open');
    }

    document.getElementById('bs-pab-inspector-close').addEventListener('click', closeInspector);

    function renderInspector() {
      const inspectorEl = document.getElementById('bs-pab-inspector');
      inspectorEl.innerHTML = '';

      ensureSelectedField();
      const field = getFieldById(state.selectedFieldId);

      if (!state.inspectorOpen) return;

      document.getElementById('bs-pab-inspector-title').textContent = 'Field Settings';

      if (!field) {
        inspectorEl.innerHTML = `<div class="bs-pab-empty-state"><strong>No field selected</strong>Select a field on the canvas to edit its settings.</div>`;
        return;
      }

      // ---- BASIC SECTION ----
      const basicSec = makeSectionEl('Basic');

      if (field.type !== 'static_text') {
        const labelG = makeFieldGroup('Label');
        const labelInp = makeInput('input', field.label || '', field.type === 'header' ? 'Section title' : 'Question text', (val) => {
          field.label = val;
          updateLastModified();
          renderCanvas();
          renderNavigator();
        });
        labelG.appendChild(labelInp);
        basicSec.appendChild(labelG);
      }

      if (field.type === 'static_text') {
        const g = makeFieldGroup('Content');
        const ta = makeInput('textarea', field.settings.content || '', 'Instructions text', (val) => {
          field.settings.content = val;
          updateLastModified();
          renderCanvas();
        });
        g.appendChild(ta);
        basicSec.appendChild(g);
      }

      if (field.type !== 'static_text') {
        const descG = makeFieldGroup('Description (optional)', 'Helper text shown below the question.');
        const descTa = makeInput('textarea', field.description || '', 'Optional helper text…', (val) => {
          field.description = val;
          updateLastModified();
        });
        descG.appendChild(descTa);
        basicSec.appendChild(descG);
      }

      // Required toggle
      if (['text','memo','number','date','single_select','multi_select','boolean','doc_upload'].includes(field.type)) {
        basicSec.appendChild(makeToggleRow('Required', 'Applicants must answer this question.', field.required, (val) => {
          field.required = val;
          updateLastModified();
          renderCanvas();
          renderStatusBar();
        }));
      }

      // Active toggle
      basicSec.appendChild(makeToggleRow('Active', 'Turn off to hide from new applications but keep for historical data.', field.active, (val) => {
        field.active = val;
        updateLastModified();
        renderCanvas();
        renderStatusBar();
      }));

      inspectorEl.appendChild(basicSec);

      // ---- REPEATABLE (header only) ----
      if (field.type === 'header') {
        if (!field.settings) field.settings = {};
        const repSec = makeSectionEl('Repeatable');

        const repHelp = document.createElement('div');
        repHelp.className = 'bs-pab-helper';
        repHelp.textContent = 'Allow applicants to add multiple entries for this section (e.g., multiple parents, contacts, or siblings).';
        repHelp.style.marginBottom = '8px';
        repSec.appendChild(repHelp);

        const isRepeatable = !!field.settings.repeatable;
        repSec.appendChild(makeToggleRow('Allow multiple entries', null, isRepeatable, (val) => {
          field.settings.repeatable = val;
          if (val && field.settings.minEntries == null) field.settings.minEntries = 0;
          if (val && field.settings.maxEntries === undefined) field.settings.maxEntries = null;
          updateLastModified();
          renderCanvas();
          renderNavigator();
          renderInspector();
        }));

        if (isRepeatable) {
          const entryLabelG = makeFieldGroup('Entry label', 'Name for each individual entry — used in the "Add" button and as a heading (e.g., "Parent/Guardian", "Emergency Contact").');
          const entryLabelInp = makeInput('input', field.settings.entryLabel || '', 'e.g. Parent/Guardian', (val) => {
            field.settings.entryLabel = val;
            updateLastModified();
            renderCanvas();
          });
          entryLabelG.appendChild(entryLabelInp);
          repSec.appendChild(entryLabelG);

          const minG = makeFieldGroup('Minimum entries', '0 = section is optional; 1 = at least one entry is required.');
          const minInp = makeInput('number', field.settings.minEntries ?? 0, '0', (val) => {
            field.settings.minEntries = val === '' ? 0 : Math.max(0, parseInt(val, 10) || 0);
            updateLastModified();
          });
          minInp.min = '0';
          minG.appendChild(minInp);
          repSec.appendChild(minG);

          const maxG = makeFieldGroup('Maximum entries', 'Leave blank for unlimited.');
          const maxInp = makeInput('number', field.settings.maxEntries ?? '', '', (val) => {
            field.settings.maxEntries = val === '' ? null : Math.max(1, parseInt(val, 10) || 1);
            updateLastModified();
          });
          maxInp.min = '1';
          maxG.appendChild(maxInp);
          repSec.appendChild(maxG);
        }

        inspectorEl.appendChild(repSec);
      }

      // ---- MAPPING ----
      if (field.type !== 'header' && field.type !== 'static_text') {
        const mapSec = makeSectionEl('Mapping');
        const mapG = makeFieldGroup('Map to BlueStep field (optional)');
        const sel = document.createElement('select');
        sel.className = 'bs-pab-select';
        MAP_TO_OPTIONS.forEach(opt => {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          if ((field.mapTo || '') === opt.value) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', (e) => {
          field.mapTo = e.target.value || '';
          updateLastModified();
          renderCanvas();
          renderStatusBar();
        });
        mapG.appendChild(sel);
        mapSec.appendChild(mapG);
        inspectorEl.appendChild(mapSec);
      }

      // ---- LOGIC ----
      const logicSec = makeSectionEl('Logic (Show / Hide)');

      const logicHelp = document.createElement('div');
      logicHelp.className = 'bs-pab-helper';
      logicHelp.textContent = 'Show this field only when another question has a specific answer.';
      logicHelp.style.marginBottom = '8px';
      logicSec.appendChild(logicHelp);

      const hasRule = !!field.visibilityRule;
      logicSec.appendChild(makeToggleRow('Conditional', 'When enabled, this field appears only if the rule matches.', hasRule, (val) => {
        if (val) {
          field.visibilityRule = { sourceFieldId: '', match: {} };
        } else {
          field.visibilityRule = null;
        }
        updateLastModified();
        renderCanvas();
        renderInspector();
      }));

      if (field.visibilityRule) {
        const ruleArea = buildLogicRuleArea(field);
        logicSec.appendChild(ruleArea);
      }

      inspectorEl.appendChild(logicSec);

      // ---- TYPE-SPECIFIC ----
      const typeSec = makeSectionEl('Type Settings');

      if (field.type === 'text' || field.type === 'memo') {
        // Formatter (text only)
        if (field.type === 'text') {
          const fmtG = makeFieldGroup('Format enforcement (optional)', 'Forces the applicant\'s input to match a specific format. The interpreter will validate on submit.');
          const fmtSel = document.createElement('select');
          fmtSel.className = 'bs-pab-select';

          const fmtOptions = [
            { value: '',        label: '— None —' },
            { value: 'phone',   label: 'Phone  •  (123) 456-7890' },
            { value: 'email',   label: 'Email  •  name@example.com' },
            { value: 'zip',     label: 'Zip Code  •  12345 or 12345-6789' },
            { value: 'url',     label: 'Web Address  •  https://example.com' }
          ];

          fmtOptions.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            if ((field.settings.formatter || '') === opt.value) o.selected = true;
            fmtSel.appendChild(o);
          });

          fmtSel.addEventListener('change', (e) => {
            field.settings.formatter = e.target.value || '';
            updateLastModified();
            renderCanvas();
          });

          fmtG.appendChild(fmtSel);
          typeSec.appendChild(fmtG);
        }
        const maxG = makeFieldGroup('Max length (characters)');
        const maxInp = makeInput('number', field.settings.maxLength || '', '', (val) => {
          field.settings.maxLength = val ? parseInt(val, 10) : null;
          updateLastModified();
        });
        maxInp.min = '1';
        maxG.appendChild(maxInp);
        typeSec.appendChild(maxG);

        const phG = makeFieldGroup('Placeholder (optional)');
        const phInp = makeInput('input', field.settings.placeholder || '', 'Placeholder text', (val) => {
          field.settings.placeholder = val;
          updateLastModified();
        });
        phG.appendChild(phInp);
        typeSec.appendChild(phG);
      }

      if (field.type === 'number') {
        const minG = makeFieldGroup('Minimum (optional)');
        const minInp = makeInput('number', field.settings.min ?? '', '', (val) => {
          field.settings.min = val === '' ? null : Number(val);
          updateLastModified();
        });
        minG.appendChild(minInp);
        typeSec.appendChild(minG);

        const maxG = makeFieldGroup('Maximum (optional)');
        const maxInp = makeInput('number', field.settings.max ?? '', '', (val) => {
          field.settings.max = val === '' ? null : Number(val);
          updateLastModified();
        });
        maxG.appendChild(maxInp);
        typeSec.appendChild(maxG);
      }

      if (field.type === 'date') {
        const minG = makeFieldGroup('Earliest date (optional)');
        const minInp = makeInput('date', field.settings.minDate || '', '', (val) => {
          field.settings.minDate = val || null;
          updateLastModified();
        });
        minG.appendChild(minInp);
        typeSec.appendChild(minG);

        const maxG = makeFieldGroup('Latest date (optional)');
        const maxInp = makeInput('date', field.settings.maxDate || '', '', (val) => {
          field.settings.maxDate = val || null;
          updateLastModified();
        });
        maxG.appendChild(maxInp);
        typeSec.appendChild(maxG);
      }

      if (field.type === 'single_select' || field.type === 'multi_select') {
        const optLbl = document.createElement('div');
        optLbl.className = 'bs-pab-label';
        optLbl.textContent = 'Options';
        optLbl.style.marginBottom = '6px';
        typeSec.appendChild(optLbl);

        const optList = document.createElement('div');
        optList.className = 'bs-pab-options-list';

        (field.settings.options || []).forEach(opt => {
          const row = document.createElement('div');
          row.className = 'bs-pab-option-row';

          const inp = document.createElement('input');
          inp.className = 'bs-pab-input';
          inp.value = opt.label || '';
          inp.placeholder = 'Option label';
          inp.addEventListener('input', (e) => {
            opt.label = e.target.value;
            updateLastModified();
            renderCanvas();
          });

          const chip = document.createElement('div');
          chip.className = 'bs-pab-option-chip';
          chip.textContent = opt.active ? 'Active' : 'Inactive';
          chip.style.cursor = 'pointer';
          chip.style.opacity = opt.active ? '1' : '0.5';
          chip.addEventListener('click', () => {
            opt.active = !opt.active;
            chip.textContent = opt.active ? 'Active' : 'Inactive';
            chip.style.opacity = opt.active ? '1' : '0.5';
            updateLastModified();
          });

          const delBtn = document.createElement('button');
          delBtn.className = 'bs-pab-icon-btn bs-pab-icon-btn-danger';
          delBtn.title = 'Remove option';
          delBtn.textContent = '✕';
          delBtn.addEventListener('click', () => {
            field.settings.options = field.settings.options.filter(o => o.id !== opt.id);
            updateLastModified();
            renderInspector();
          });

          row.appendChild(inp);
          row.appendChild(chip);
          row.appendChild(delBtn);
          optList.appendChild(row);
        });

        typeSec.appendChild(optList);

        const addOptBtn = document.createElement('button');
        addOptBtn.className = 'bs-pab-btn bs-pab-btn-outline';
        addOptBtn.style.marginTop = '8px';
        addOptBtn.textContent = '+ Add option';
        addOptBtn.addEventListener('click', () => {
          field.settings.options = field.settings.options || [];
          field.settings.options.push({ id: generateUuid(), label: 'New option', active: true });
          updateLastModified();
          renderInspector();
        });
        typeSec.appendChild(addOptBtn);
      }

      if (field.type === 'boolean') {
        const trueG = makeFieldGroup('True label');
        const trueInp = makeInput('input', field.settings.trueLabel || 'Yes', '', (val) => {
          field.settings.trueLabel = val || 'Yes';
          updateLastModified();
        });
        trueG.appendChild(trueInp);
        typeSec.appendChild(trueG);

        const falseG = makeFieldGroup('False label');
        const falseInp = makeInput('input', field.settings.falseLabel || 'No', '', (val) => {
          field.settings.falseLabel = val || 'No';
          updateLastModified();
        });
        falseG.appendChild(falseInp);
        typeSec.appendChild(falseG);
      }

      if (field.type === 'doc_upload') {
        if (!field.settings) field.settings = {};

        const acceptG = makeFieldGroup('Accepted file types', 'Comma-separated extensions shown to the applicant (e.g. .pdf,.jpg,.png). Leave blank to allow any file.');
        const acceptInp = makeInput('input', field.settings.accept || '', 'e.g. .pdf,.jpg,.png', (val) => {
          field.settings.accept = val;
          updateLastModified();
        });
        acceptG.appendChild(acceptInp);
        typeSec.appendChild(acceptG);

        const sizeG = makeFieldGroup('Max file size (MB)', 'Client-side size limit. Leave blank or 0 for no limit.');
        const sizeInp = makeInput('input', field.settings.maxSizeMb != null ? String(field.settings.maxSizeMb) : '10', '', (val) => {
          const n = parseFloat(val);
          field.settings.maxSizeMb = isNaN(n) || n <= 0 ? null : n;
          updateLastModified();
        });
        sizeInp.type = 'number';
        sizeInp.min = '0';
        sizeG.appendChild(sizeInp);
        typeSec.appendChild(sizeG);
      }

      if (typeSec.children.length > 0) {
        inspectorEl.appendChild(typeSec);
      }

      // ---- DEBUG JSON ----
      const debugSec = makeSectionEl('Draft JSON (debug)');
      const pre = document.createElement('pre');
      pre.className = 'bs-pab-json-preview';
      pre.textContent = JSON.stringify(state.draft, null, 2);
      debugSec.appendChild(pre);
      inspectorEl.appendChild(debugSec);
    }

    function buildLogicRuleArea(field) {
      const wrap = document.createElement('div');
      wrap.className = 'bs-pab-logic-rule-area';

      field.visibilityRule = field.visibilityRule || { sourceFieldId: '', match: {} };

      // Source field select
      const srcG = makeFieldGroup('Show this field when…');
      const srcSel = document.createElement('select');
      srcSel.className = 'bs-pab-select';

      const defOpt = document.createElement('option');
      defOpt.value = '';
      defOpt.textContent = '— Choose a question —';
      srcSel.appendChild(defOpt);

      getLogicEligibleSourceFields().forEach(src => {
        if (src.id === field.id) return;
        const o = document.createElement('option');
        o.value = src.id;
        o.textContent = `${getFieldLabelForLogic(src)} • ${fieldTypeLabel(src.type)}`;
        if (field.visibilityRule.sourceFieldId === src.id) o.selected = true;
        srcSel.appendChild(o);
      });

      srcSel.addEventListener('change', (e) => {
        field.visibilityRule.sourceFieldId = e.target.value || '';
        field.visibilityRule.match = {};
        const src = getFieldById(field.visibilityRule.sourceFieldId);
        if (src && src.type === 'boolean') {
          field.visibilityRule.match.boolean = { true: true, false: false };
        } else if (src && (src.type === 'single_select' || src.type === 'multi_select')) {
          field.visibilityRule.match.optionIds = [];
        }
        updateLastModified();
        renderCanvas();
        renderInspector();
      });

      srcG.appendChild(srcSel);
      wrap.appendChild(srcG);

      const src = getFieldById(field.visibilityRule.sourceFieldId);
      if (!src) return wrap;

      if (src.type === 'boolean') {
        field.visibilityRule.match = field.visibilityRule.match || {};
        field.visibilityRule.match.boolean = field.visibilityRule.match.boolean || { true: false, false: false };

        const boolG = makeFieldGroup('Show when answer is');
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-top:4px;';

        ['true', 'false'].forEach(key => {
          const label = key === 'true' ? (src.settings?.trueLabel || 'Yes') : (src.settings?.falseLabel || 'No');
          const lbl = document.createElement('label');
          lbl.style.cssText = 'display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12.5px;';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!field.visibilityRule.match.boolean[key];
          cb.addEventListener('change', () => {
            field.visibilityRule.match.boolean[key] = cb.checked;
            updateLastModified();
            renderCanvas();
          });
          lbl.appendChild(cb);
          lbl.appendChild(document.createTextNode(label));
          row.appendChild(lbl);
        });

        boolG.appendChild(row);
        wrap.appendChild(boolG);
      }

      if (src.type === 'single_select' || src.type === 'multi_select') {
        field.visibilityRule.match = field.visibilityRule.match || {};
        field.visibilityRule.match.optionIds = Array.isArray(field.visibilityRule.match.optionIds)
          ? field.visibilityRule.match.optionIds : [];

        const optG = makeFieldGroup('Show when selected includes (any)');
        const options = src.settings && Array.isArray(src.settings.options) ? src.settings.options : [];

        if (!options.length) {
          const msg = document.createElement('div');
          msg.className = 'bs-pab-helper';
          msg.textContent = 'Source question has no options yet.';
          optG.appendChild(msg);
        } else {
          const list = document.createElement('div');
          list.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-top:6px;';
          options.forEach(opt => {
            const lbl = document.createElement('label');
            lbl.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;' +
              (opt.active ? '' : 'opacity:0.5;');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = field.visibilityRule.match.optionIds.includes(opt.id);
            cb.addEventListener('change', () => {
              const arr = field.visibilityRule.match.optionIds;
              const idx = arr.indexOf(opt.id);
              if (cb.checked && idx === -1) arr.push(opt.id);
              if (!cb.checked && idx !== -1) arr.splice(idx, 1);
              updateLastModified();
              renderCanvas();
            });
            lbl.appendChild(cb);
            lbl.appendChild(document.createTextNode(opt.label || '(Unnamed option)'));
            list.appendChild(lbl);
          });
          optG.appendChild(list);
        }

        wrap.appendChild(optG);
      }

      // Summary
      const summary = document.createElement('div');
      summary.className = 'bs-pab-helper';
      summary.style.marginTop = '6px';
      summary.textContent = summarizeVisibilityRule(field.visibilityRule) || 'Conditional';
      wrap.appendChild(summary);

      // Remove logic
      const removeBtn = document.createElement('button');
      removeBtn.className = 'bs-pab-btn bs-pab-btn-outline';
      removeBtn.style.marginTop = '10px';
      removeBtn.textContent = 'Remove logic';
      removeBtn.addEventListener('click', () => {
        field.visibilityRule = null;
        updateLastModified();
        renderCanvas();
        renderInspector();
      });
      wrap.appendChild(removeBtn);

      return wrap;
    }

    // ---- Inspector helpers ----
    function makeSectionEl(title) {
      const sec = document.createElement('div');
      sec.className = 'bs-pab-inspector-section';
      const t = document.createElement('div');
      t.className = 'bs-pab-insp-section-title';
      t.textContent = title;
      sec.appendChild(t);
      return sec;
    }

    function makeFieldGroup(label, helper) {
      const g = document.createElement('div');
      g.className = 'bs-pab-field-group';
      const lbl = document.createElement('label');
      lbl.className = 'bs-pab-label';
      lbl.textContent = label;
      g.appendChild(lbl);
      if (helper) {
        const h = document.createElement('div');
        h.className = 'bs-pab-helper';
        h.textContent = helper;
        g.appendChild(h);
      }
      return g;
    }

    function makeInput(type, value, placeholder, onChange) {
      let el;
      if (type === 'textarea') {
        el = document.createElement('textarea');
        el.className = 'bs-pab-textarea';
      } else {
        el = document.createElement('input');
        el.className = 'bs-pab-input';
        el.type = type;
      }
      el.value = value;
      if (placeholder) el.placeholder = placeholder;
      el.addEventListener('input', (e) => onChange(e.target.value));
      return el;
    }

    function makeToggleRow(label, helper, isOn, onChange) {
      const row = document.createElement('div');
      row.className = 'bs-pab-toggle-row';

      const left = document.createElement('div');
      const lbl = document.createElement('div');
      lbl.className = 'bs-pab-label';
      lbl.textContent = label;
      left.appendChild(lbl);

      if (helper) {
        const h = document.createElement('div');
        h.className = 'bs-pab-helper';
        h.textContent = helper;
        left.appendChild(h);
      }

      const pill = document.createElement('div');
      pill.className = 'bs-pab-toggle-pill' + (isOn ? ' bs-pab-toggle-on' : '');
      let current = isOn;
      pill.addEventListener('click', () => {
        current = !current;
        pill.classList.toggle('bs-pab-toggle-on', current);
        onChange(current);
      });

      row.appendChild(left);
      row.appendChild(pill);
      return row;
    }

    // =========================================================
    // ADVANCED SETTINGS MODAL — events
    // =========================================================
    const advSettingsOverlay = document.getElementById('bs-pab-adv-settings-overlay');
    document.getElementById('bs-pab-adv-settings-btn').addEventListener('click', () => {
      renderAdvancedSettings();
      advSettingsOverlay.style.display = 'flex';
    });
    document.getElementById('bs-pab-adv-settings-close').addEventListener('click', () => {
      advSettingsOverlay.style.display = 'none';
    });
    advSettingsOverlay.addEventListener('click', e => {
      if (e.target === advSettingsOverlay) advSettingsOverlay.style.display = 'none';
    });

    // =========================================================
    // LOGIC OVERVIEW MODAL
    // =========================================================
    document.getElementById('bs-pab-logic-view-btn').addEventListener('click', () => {
      renderLogicOverview();
      document.getElementById('bs-pab-logic-overlay').style.display = 'flex';
    });

    document.getElementById('bs-pab-logic-close').addEventListener('click', () => {
      document.getElementById('bs-pab-logic-overlay').style.display = 'none';
    });

    document.getElementById('bs-pab-logic-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
    });

    function renderLogicOverview() {
      const content = document.getElementById('bs-pab-logic-table-content');
      content.innerHTML = '';

      const conditionalFields = (state.draft.fields || []).filter(
        f => f.visibilityRule && f.visibilityRule.sourceFieldId
      );

      if (!conditionalFields.length) {
        content.innerHTML = `<div class="bs-pab-logic-empty">No conditional logic rules defined yet.<br>Select a field and enable "Conditional" in its settings.</div>`;
        return;
      }

      const table = document.createElement('table');
      table.className = 'bs-pab-logic-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Condition</th>
            <th>Actions</th>
          </tr>
        </thead>
      `;

      const tbody = document.createElement('tbody');
      conditionalFields.forEach(field => {
        const tr = document.createElement('tr');
        const summary = summarizeVisibilityRule(field.visibilityRule) || 'Conditional';

        tr.innerHTML = `
          <td><strong>${escHtml(fieldPreviewLabel(field))}</strong></td>
          <td>${escHtml(fieldTypeLabel(field.type))}</td>
          <td>${escHtml(summary)}</td>
          <td></td>
        `;

        const editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => {
          document.getElementById('bs-pab-logic-overlay').style.display = 'none';
          selectField(field.id);
          openInspector(field.id);
        });

        tr.querySelector('td:last-child').appendChild(editBtn);
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      content.appendChild(table);
    }

    // =========================================================
    // ADD FIELD PICKER MODAL
    // =========================================================
    document.getElementById('bs-pab-add-field-btn').addEventListener('click', () => {
      document.getElementById('bs-pab-picker-overlay').style.display = 'flex';
    });

    document.getElementById('bs-pab-picker-close').addEventListener('click', () => {
      document.getElementById('bs-pab-picker-overlay').style.display = 'none';
    });

    document.getElementById('bs-pab-picker-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
    });

    document.querySelectorAll('.bs-pab-picker-card').forEach(card => {
      const type = card.getAttribute('data-field-type');
      if (!type) return;

      card.addEventListener('click', () => {
        document.getElementById('bs-pab-picker-overlay').style.display = 'none';
        const newField = createEmptyField(type);

        // Insert after selected field; fall back to appending at bottom
        const fields = state.draft.fields;
        const selectedIdx = state.selectedFieldId
          ? fields.findIndex(f => f.id === state.selectedFieldId)
          : -1;

        if (selectedIdx !== -1) {
          fields.splice(selectedIdx + 1, 0, newField);
        } else {
          fields.push(newField);
        }

        state.selectedFieldId = newField.id;
        updateLastModified();
        renderAll();
        // Auto-scroll to new field
        setTimeout(() => {
          const el = canvasEl.querySelector(`[data-field-id="${newField.id}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
      });

      // Drag from picker to canvas
      card.setAttribute('draggable', 'true');
      card.addEventListener('dragstart', (e) => {
        state.draggingNewType = type;
        try { e.dataTransfer.setData('text/plain', type); } catch (_) {}
        e.dataTransfer.effectAllowed = 'copy';
        document.getElementById('bs-pab-picker-overlay').style.display = 'none';
      });
      card.addEventListener('dragend', () => {
        state.draggingNewType = null;
        clearDropIndicators();
      });
    });

    // =========================================================
    // SEARCH / FILTER
    // =========================================================
    const canvasSearchInput = document.getElementById('bs-pab-canvas-search');
    const canvasSearchClear = document.getElementById('bs-pab-canvas-search-clear');

    canvasSearchInput.addEventListener('input', (e) => {
      state.canvasFilter = e.target.value;
      canvasSearchClear.style.display = state.canvasFilter ? 'block' : 'none';
      renderCanvas();
    });
    canvasSearchClear.addEventListener('click', () => {
      canvasSearchInput.value = '';
      state.canvasFilter = '';
      canvasSearchClear.style.display = 'none';
      renderCanvas();
    });

    const navSearchInput = document.getElementById('bs-pab-nav-search');
    const navSearchClear = document.getElementById('bs-pab-search-clear');

    navSearchInput.addEventListener('input', (e) => {
      state.navFilter = e.target.value;
      navSearchClear.style.display = state.navFilter ? 'block' : 'none';
      renderNavigator();
    });
    navSearchClear.addEventListener('click', () => {
      navSearchInput.value = '';
      state.navFilter = '';
      navSearchClear.style.display = 'none';
      renderNavigator();
    });

    // =========================================================
    // COLLAPSE ALL SECTIONS
    // =========================================================
    document.getElementById('bs-pab-collapse-all-btn').addEventListener('click', () => {
      const headers = (state.draft.fields || []).filter(f => f.type === 'header');
      const allCollapsed = headers.every(h => state.collapsedSections.has(h.id));
      if (allCollapsed) {
        state.collapsedSections.clear();
      } else {
        headers.forEach(h => state.collapsedSections.add(h.id));
      }
      renderCanvas();
      renderNavigator();
    });

    // =========================================================
    // VIEW TOGGLE (normal / compact)
    // =========================================================
    document.getElementById('bs-pab-view-normal').addEventListener('click', () => {
      state.compactView = false;
      document.getElementById('bs-pab-view-normal').classList.add('bs-pab-view-active');
      document.getElementById('bs-pab-view-compact').classList.remove('bs-pab-view-active');
      renderCanvas();
    });

    document.getElementById('bs-pab-view-compact').addEventListener('click', () => {
      state.compactView = true;
      document.getElementById('bs-pab-view-compact').classList.add('bs-pab-view-active');
      document.getElementById('bs-pab-view-normal').classList.remove('bs-pab-view-active');
      renderCanvas();
    });

    // =========================================================
    // SAVE / PUBLISH
    // =========================================================
    function postJson(url, payload) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const saveBtn = document.getElementById('bs-pab-save-btn');
    const publishBtn = document.getElementById('bs-pab-publish-btn');

    saveBtn.addEventListener('click', () => {
      const payload = clone(state.draft);
      payload.facilityId = facilityId;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      postJson(SAVE_ENDPOINT, payload)
        .then(() => {
          saveBtn.textContent = '✓ Saved';
          setTimeout(() => { saveBtn.textContent = '💾 Save Draft'; saveBtn.disabled = false; }, 1500);
        })
        .catch(err => {
          console.error('Save failed', err);
          saveBtn.textContent = 'Error – retry';
          saveBtn.disabled = false;
        });
    });

    publishBtn.addEventListener('click', () => {
      if (!confirm('Publish this application? This will become the live version used for new applicants.')) return;
      const payload = clone(state.draft);
      payload.facilityId = facilityId;
      publishBtn.disabled = true;
      publishBtn.textContent = 'Publishing…';
      postJson(PUBLISH_ENDPOINT, payload)
        .then(() => {
          publishBtn.textContent = '✓ Published';
          setTimeout(() => { publishBtn.textContent = '🚀 Publish'; publishBtn.disabled = false; }, 1500);
        })
        .catch(err => {
          console.error('Publish failed', err);
          publishBtn.textContent = 'Error – retry';
          publishBtn.disabled = false;
        });
    });

    // =========================================================
    // HELPERS
    // =========================================================
    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // =========================================================
    // RENDER ALL
    // =========================================================
    function renderAll() {
      renderCanvas();
      renderNavigator();
      renderStatusBar();
      if (state.inspectorOpen) renderInspector();
    }

    // =========================================================
    // BOOT
    // =========================================================
    document.getElementById('bs-pab-form-title-display').textContent =
      state.draft.title || 'Application Builder';

    renderAll();

  } // end initBuilder
})();