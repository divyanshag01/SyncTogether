/**
 * room-ui.js — Visual Enhancement Layer
 *
 * Reads window.uiState for status indicators.
 * Enhances participant list and chat with richer presentation.
 * Does NOT modify business logic, socket behavior, or synchronization.
 */
(function () {
    'use strict';

    // Ensure uiState exists before room.js (module, deferred) accesses it
    window.uiState = window.uiState || {};

    /* ═══════════════ DOM REFERENCES ═══════════════ */

    var pillSync    = document.getElementById('status-sync');
    var pillOffset  = document.getElementById('status-offset');
    var pillSubs    = document.getElementById('status-subtitles');
    var pillCompat  = document.getElementById('status-compatibility');
    var countEl     = document.getElementById('participant-count');
    var hostEl      = document.getElementById('host-name');
    var ctrlNameEl  = document.getElementById('controller-name');
    var offsetValEl = document.getElementById('offset-current-display');
    var subSelect   = document.getElementById('subtitle-track-select');

    /* ═══════════════ STATUS PILLS ═══════════════ */

    function refreshPills() {
        var s = window.uiState;
        if (!s) return;

        // Host is the source of truth — hide sync & compatibility pills
        var isHost = !!window.isHost;
        if (pillSync)   pillSync.style.display  = isHost ? 'none' : '';
        if (pillCompat) pillCompat.style.display = isHost ? 'none' : '';

        _setText(pillSync,   '.pill-text', s.syncStatus || 'Synced');
        _setText(pillOffset, '.pill-text', _fmtOffsetPill(s.offset));
        _setText(pillSubs,   '.pill-text', (s.subtitleCount || 0) + ' Subtitle Tracks');
        _setText(pillCompat, '.pill-text', 'Compatibility ' + (s.compatibility || '—'));

        if (countEl && s.participantCount !== undefined) {
            countEl.textContent = s.participantCount;
        }
        if (hostEl && s.hostName) {
            hostEl.textContent = 'hosted by ' + s.hostName + ' 👑';
        }
        if (ctrlNameEl && s.controllerName) {
            ctrlNameEl.textContent = s.controllerName;
        }
        if (offsetValEl && s.offset !== undefined) {
            var n = Number(s.offset);
            offsetValEl.textContent = (n >= 0 ? '+' : '') + n + 's';
        }
    }

    function _fmtOffsetPill(v) {
        if (v === undefined || v === null) return 'Offset 0s';
        var n = Number(v);
        return 'Offset ' + (n >= 0 ? '+' : '') + n + 's';
    }

    function _setText(parent, sel, text) {
        if (!parent) return;
        var el = parent.querySelector(sel);
        if (el) el.textContent = text;
    }

    // Listen for explicit state-change events
    window.addEventListener('ui-state-change', refreshPills);

    // Poll for state changes every 500ms (catches compatibility updates from videosync.js)
    setInterval(refreshPills, 500);

    /* ═══════════════ SUBTITLE COUNT FROM DOM ═══════════════ */

    if (subSelect) {
        var subObs = new MutationObserver(function () {
            var count = Math.max(0, subSelect.options.length - 1);
            window.uiState.subtitleCount = count;
            _setText(pillSubs, '.pill-text', count + ' Subtitle Tracks');
        });
        subObs.observe(subSelect, { childList: true });
    }

    /* ═══════════════ PARTICIPANT ENHANCEMENT ═══════════════ */

    var usersList = document.getElementById('users-list');
    var _enhTimer = null;

    function enhanceParticipants() {
        if (!usersList) return;
        var lis = usersList.querySelectorAll('li');

        // Update participant count
        if (countEl) {
            countEl.textContent = window.uiState.participantCount || lis.length;
        }

        lis.forEach(function (li) {
            if (li.dataset.uiDone) return;
            li.dataset.uiDone = '1';

            var span = li.querySelector('span');
            if (!span) return;

            // Read role from data attributes set by room.js
            var role = li.dataset.role || 'viewer';
            var name = li.dataset.username || span.textContent.trim();

            // Fallback: update host/controller from DOM if uiState empty
            if (role === 'host' && hostEl && !window.uiState.hostName) {
                hostEl.textContent = 'hosted by ' + name + ' 👑';
            }
            if (role === 'controller' && ctrlNameEl && !window.uiState.controllerName) {
                ctrlNameEl.textContent = name;
            }

            // Avatar
            var av = document.createElement('div');
            av.className = 'participant-avatar';
            av.setAttribute('data-role', role);
            var hue = _hashHue(name);
            av.style.background = _roleClr(role, 0.15) || 'hsla(' + hue + ',58%,62%,0.15)';
            av.style.color      = _roleClr(role, 1)    || 'hsl(' + hue + ',58%,62%)';
            av.textContent = name.charAt(0).toUpperCase();

            // Update span to show clean username + role emoji
            span.className = 'participant-name';
            var emoji = role === 'host' ? ' 👑' : role === 'controller' ? ' 🎮' : '';
            span.textContent = name + emoji;

            // Role badge
            var badge = document.createElement('span');
            badge.className = 'participant-badge';
            badge.setAttribute('data-role', role);
            badge.textContent = role.charAt(0).toUpperCase() + role.slice(1);

            // DOM insertion — avatar first, badge before button
            li.insertBefore(av, li.firstChild);
            var btn = li.querySelector('button');
            if (btn) li.insertBefore(badge, btn);
            else     li.appendChild(badge);

            li.classList.add('participant-enhanced');
        });

        // Refresh pills whenever participant list rebuilds
        refreshPills();
    }

    if (usersList) {
        var usersObs = new MutationObserver(function () {
            clearTimeout(_enhTimer);
            _enhTimer = setTimeout(enhanceParticipants, 25);
        });
        usersObs.observe(usersList, { childList: true });
    }

    /* ═══════════════ CHAT ENHANCEMENT ═══════════════ */

    var chatBox = document.getElementById('chat-messages');
    var _uColors = {};
    var _palette = ['#34d399','#a78bfa','#f59e0b','#60a5fa','#f472b6','#22d3ee','#fb923c','#a3e635'];
    var _cIdx = 0;

    function _chatClr(u) {
        if (!_uColors[u]) { _uColors[u] = _palette[_cIdx++ % _palette.length]; }
        return _uColors[u];
    }

    if (chatBox) {
        var chatObs = new MutationObserver(function (muts) {
            for (var m = 0; m < muts.length; m++) {
                var added = muts[m].addedNodes;
                for (var i = 0; i < added.length; i++) {
                    var nd = added[i];
                    if (nd.nodeType !== 1 || nd.dataset.uiDone) continue;
                    nd.dataset.uiDone = '1';

                    var txt = nd.textContent || '';
                    // Parse: "Username HH:MM AM: message"
                    var match = txt.match(/^(.+?)\s+(\d{1,2}:\d{2}\s*[APap][Mm]):\s*(.+)$/);
                    if (!match) continue;

                    var uname  = match[1].trim();
                    var tstamp = match[2];
                    var body   = match[3];
                    var clr    = _chatClr(uname);

                    nd.textContent = '';
                    nd.classList.add('chat-msg');

                    // Avatar
                    var cAv = document.createElement('div');
                    cAv.className = 'chat-avatar';
                    cAv.style.background = clr + '1a';
                    cAv.style.color = clr;
                    cAv.textContent = uname.charAt(0).toUpperCase();

                    // Content
                    var wrap = document.createElement('div');
                    wrap.className = 'chat-msg-content';

                    var hdr = document.createElement('div');
                    hdr.className = 'chat-msg-header';

                    var nm = document.createElement('span');
                    nm.className = 'chat-msg-name';
                    nm.style.color = clr;
                    nm.textContent = uname;

                    var tm = document.createElement('span');
                    tm.className = 'chat-msg-time';
                    tm.textContent = tstamp;

                    hdr.appendChild(nm);
                    hdr.appendChild(tm);

                    var bd = document.createElement('div');
                    bd.className = 'chat-msg-body';
                    bd.textContent = body;

                    wrap.appendChild(hdr);
                    wrap.appendChild(bd);
                    nd.appendChild(cAv);
                    nd.appendChild(wrap);
                }
            }
        });
        chatObs.observe(chatBox, { childList: true });
    }

    /* ═══════════════ OFFSET: CLOSE POPUP + IMMEDIATE UPDATE ═══════════════ */

    var applyBtn = document.getElementById('apply-offset');
    var clearBtn = document.getElementById('clear-offset');
    var offsetPopover = document.querySelector('.offset-popover');

    if (applyBtn) {
        applyBtn.addEventListener('click', function () {
            // Close the popover immediately
            if (offsetPopover) offsetPopover.removeAttribute('open');

            // Immediately update offset display (don't wait for server round-trip)
            if (window.isHost) return; // host can't set offset, room.js shows toast
            var dirEl  = document.getElementById('offset-direction');
            var secEl  = document.getElementById('offset-seconds');
            var dir    = dirEl ? dirEl.value : '';
            var sec    = secEl ? Number(secEl.value) : 0;
            if (!sec || sec < 0 || !dir || dir === 'select') return;

            var offset = (dir === 'ahead') ? -sec : sec;
            window.uiState.offset = offset;
            var formatted = (offset >= 0 ? '+' : '') + offset + 's';
            if (offsetValEl) offsetValEl.textContent = formatted;
            _setText(pillOffset, '.pill-text', 'Offset ' + formatted);
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            // Close the popover
            if (offsetPopover) offsetPopover.removeAttribute('open');

            // Immediately reset offset display
            window.uiState.offset = 0;
            if (offsetValEl) offsetValEl.textContent = '+0s';
            _setText(pillOffset, '.pill-text', 'Offset +0s');
        });
    }

    /* ═══════════════ DYNAMIC AMBIENT LIGHTING ═══════════════ */

    var video     = document.getElementById('video-player');
    var glowEl    = document.querySelector('.video-ambient-glow');
    var _ambCanvas, _ambCtx;
    var _ambActive = false;
    var _ambTimer  = null;
    var SAMPLE_INTERVAL = 2000; // ms between frame samples
    var SAMPLE_SIZE = 8;        // downscaled canvas dimension

    function _initAmbientCanvas() {
        if (_ambCanvas) return;
        _ambCanvas = document.createElement('canvas');
        _ambCanvas.width  = SAMPLE_SIZE;
        _ambCanvas.height = SAMPLE_SIZE;
        _ambCtx = _ambCanvas.getContext('2d', { willReadFrequently: true });
    }

    function _sampleColors() {
        if (!video || !glowEl || video.paused || video.ended || !video.videoWidth) {
            _stopAmbient();
            return;
        }
        try {
            _ambCtx.drawImage(video, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
            var data = _ambCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;

            // Sample 3 regions: top-left quadrant, bottom-right quadrant, center
            var tl = _avgRegion(data, 0, 0, 4, 4);
            var br = _avgRegion(data, 4, 4, 4, 4);
            var ct = _avgRegion(data, 2, 2, 4, 4);

            var alpha = 0.55;
            glowEl.style.setProperty('--glow-tl',     'rgba(' + tl.r + ',' + tl.g + ',' + tl.b + ',' + alpha + ')');
            glowEl.style.setProperty('--glow-br',     'rgba(' + br.r + ',' + br.g + ',' + br.b + ',' + (alpha * 0.75) + ')');
            glowEl.style.setProperty('--glow-center', 'rgba(' + ct.r + ',' + ct.g + ',' + ct.b + ',' + (alpha * 0.6) + ')');

            if (!_ambActive) {
                glowEl.classList.add('ambient-dynamic');
                _ambActive = true;
            }
        } catch (e) {
            // CORS or other error — fall back to static
            _stopAmbient();
        }
    }

    function _avgRegion(data, sx, sy, w, h) {
        var r = 0, g = 0, b = 0, count = 0;
        for (var y = sy; y < sy + h && y < SAMPLE_SIZE; y++) {
            for (var x = sx; x < sx + w && x < SAMPLE_SIZE; x++) {
                var i = (y * SAMPLE_SIZE + x) * 4;
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
                count++;
            }
        }
        if (!count) return { r: 110, g: 86, b: 255 }; // fallback purple
        return {
            r: Math.round(r / count),
            g: Math.round(g / count),
            b: Math.round(b / count)
        };
    }

    function _startAmbient() {
        if (_ambTimer) return;
        _initAmbientCanvas();
        _sampleColors(); // sample immediately
        _ambTimer = setInterval(_sampleColors, SAMPLE_INTERVAL);
    }

    function _stopAmbient() {
        if (_ambTimer) {
            clearInterval(_ambTimer);
            _ambTimer = null;
        }
        if (_ambActive && glowEl) {
            glowEl.classList.remove('ambient-dynamic');
            glowEl.style.removeProperty('--glow-tl');
            glowEl.style.removeProperty('--glow-br');
            glowEl.style.removeProperty('--glow-center');
            _ambActive = false;
        }
    }

    if (video && glowEl) {
        video.addEventListener('play',    _startAmbient);
        video.addEventListener('playing', _startAmbient);
        video.addEventListener('pause',   _stopAmbient);
        video.addEventListener('ended',   _stopAmbient);
        video.addEventListener('emptied', _stopAmbient);
        video.addEventListener('error',   _stopAmbient);

        // If video is already playing when script loads
        if (!video.paused && video.videoWidth) _startAmbient();
    }

    /* ═══════════════ HELPERS ═══════════════ */

    function _hashHue(s) {
        var h = 0;
        for (var i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
        return Math.abs(h) % 360;
    }

    function _roleClr(role, alpha) {
        if (role === 'host')       return alpha < 1 ? 'rgba(52,211,153,'  + alpha + ')' : '#34d399';
        if (role === 'controller') return alpha < 1 ? 'rgba(167,139,250,' + alpha + ')' : '#a78bfa';
        return null; // viewers use hash-derived hue
    }

    /* ═══════════════ CUSTOM PLAYER CONTROLS — HOVER BEHAVIOR ═══════════════ */

    var controlsContainer = document.getElementById('player-controls-container');
    var videoStage        = document.querySelector('.video-stage');
    var _ctrlTimer        = null;
    var _isDragging       = false;
    var _isMenuOpen       = false;
    var _mouseInControls  = false;
    var CTRL_HIDE_DELAY   = 3000;

    function _showControls() {
        if (!controlsContainer) return;
        controlsContainer.classList.add('visible');
        _resetHideTimer();
    }

    function _hideControls() {
        if (!controlsContainer) return;
        // Never hide while dragging, menu open, or mouse inside controls
        if (_isDragging || _isMenuOpen || _mouseInControls) return;
        controlsContainer.classList.remove('visible');
    }

    function _resetHideTimer() {
        clearTimeout(_ctrlTimer);
        _ctrlTimer = setTimeout(_hideControls, CTRL_HIDE_DELAY);
    }

    function _cancelHideTimer() {
        clearTimeout(_ctrlTimer);
    }

    if (videoStage && controlsContainer) {
        videoStage.addEventListener('mouseenter', _showControls);
        videoStage.addEventListener('mousemove',  _showControls);
        videoStage.addEventListener('mouseleave', function () {
            _mouseInControls = false;
            _resetHideTimer();
        });

        // Track mouse inside controls container
        controlsContainer.addEventListener('mouseenter', function () {
            _mouseInControls = true;
            _cancelHideTimer();
            controlsContainer.classList.add('visible');
        });
        controlsContainer.addEventListener('mouseleave', function () {
            _mouseInControls = false;
            if (!_isDragging && !_isMenuOpen) {
                _resetHideTimer();
            }
        });

        // Track drag state on sliders — prevents hiding during interaction
        var _dragTargets = controlsContainer.querySelectorAll('input[type="range"]');
        _dragTargets.forEach(function (slider) {
            slider.addEventListener('mousedown', function () {
                _isDragging = true;
                _cancelHideTimer();
            });
            slider.addEventListener('touchstart', function () {
                _isDragging = true;
                _cancelHideTimer();
            }, { passive: true });
        });
        // Global mouseup/touchend to clear drag state (user may release outside slider)
        document.addEventListener('mouseup', function () {
            if (_isDragging) {
                _isDragging = false;
                if (!_mouseInControls) _resetHideTimer();
            }
        });
        document.addEventListener('touchend', function () {
            if (_isDragging) {
                _isDragging = false;
                if (!_mouseInControls) _resetHideTimer();
            }
        });

        // Clicking any button inside controls resets the hide timer
        controlsContainer.addEventListener('click', function () {
            _cancelHideTimer();
            _resetHideTimer();
        });

        // Touch support for video stage (toggle visibility)
        videoStage.addEventListener('touchstart', function () {
            if (controlsContainer.classList.contains('visible') && !_isDragging) {
                _cancelHideTimer();
                controlsContainer.classList.remove('visible');
            } else {
                _showControls();
            }
        }, { passive: true });
    }

    /* ═══════════════ SEEK BAR PROGRESS FILL ═══════════════ */

    var seekBar = document.getElementById('player-seek-bar');

    function _syncSeekFill() {
        if (!seekBar) return;
        var range = seekBar.max - seekBar.min;
        var pct = range > 0 ? ((seekBar.value - seekBar.min) / range) * 100 : 0;
        seekBar.style.setProperty('--seek-pct', pct + '%');
    }

    if (seekBar) {
        // On user interaction
        seekBar.addEventListener('input', _syncSeekFill);
        seekBar.addEventListener('change', _syncSeekFill);

        // Poll for programmatic changes (sync updates, permission changes, enable/disable)
        setInterval(_syncSeekFill, 250);

        // Initial sync
        _syncSeekFill();
    }

    /* ═══════════════ VOLUME SLIDER PROGRESS STYLING ═══════════════ */

    var volSlider = document.getElementById('player-volume-slider');

    function _syncVolFill() {
        if (!volSlider) return;
        var range = volSlider.max - volSlider.min;
        var pct = range > 0 ? ((volSlider.value - volSlider.min) / range) * 100 : 0;
        volSlider.style.setProperty('--vol-pct', pct + '%');
    }

    if (volSlider) {
        volSlider.addEventListener('input', _syncVolFill);
        volSlider.addEventListener('change', _syncVolFill);
        _syncVolFill(); // initial
    }

    /* ═══════════════ SPEED MENU TOGGLE ═══════════════ */

    var speedBtn  = document.getElementById('player-speed-btn');
    var speedMenu = document.getElementById('player-speed-menu');

    if (speedBtn && speedMenu) {
        speedBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            var opening = !speedMenu.classList.contains('open');
            speedMenu.classList.toggle('open');
            _isMenuOpen = opening;
            if (opening) {
                _cancelHideTimer(); // keep controls visible while menu is open
            } else {
                _resetHideTimer();
            }
        });

        // Close on outside click
        document.addEventListener('click', function (e) {
            if (!speedMenu.contains(e.target) && e.target !== speedBtn) {
                if (speedMenu.classList.contains('open')) {
                    speedMenu.classList.remove('open');
                    _isMenuOpen = false;
                    _resetHideTimer();
                }
            }
        });

        // Speed option selection (UI only — does not change playback rate)
        var options = speedMenu.querySelectorAll('.speed-option');
        options.forEach(function (opt) {
            opt.addEventListener('click', function () {
                // Close menu
                speedMenu.classList.remove('open');
                _isMenuOpen = false;
                _resetHideTimer();
            });
        });
    }

})();
