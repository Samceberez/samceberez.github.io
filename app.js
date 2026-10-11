'use strict';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const desktopPointer = window.matchMedia('(min-width: 1024px) and (pointer: fine)');
const hero = document.querySelector('.hero');
const heroImage = hero ? hero.querySelector('.car-stack') : null;

// Keep the original heading accessible; visual glyphs form the opening choreography.
document.querySelectorAll('.kinetic-word').forEach(word => {
  const fragment = document.createDocumentFragment();
  [...word.dataset.word].forEach((character, index) => {
    const span = document.createElement('span');
    span.className = 'char';
    span.textContent = character === ' ' ? ' ' : character;
    span.style.setProperty('--char-index', index);
    fragment.appendChild(span);
  });
  word.replaceChildren(fragment);
});

/* Liquid words (WebGL): a word is drawn once into a texture and warped by slow sine waves.
   Every wave's period divides 5s, so the loop is seamless. Used for «Заново.», «Смотрите сами.» and «идеально.». */
function createLiquid(word, frame, watch, delay = .1) {
  if (reduceMotion.matches || word.dataset.liquidOn) return;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {premultipliedAlpha: true, alpha: true, antialias: false});
  if (!gl) return root.classList.remove('liquid-ready');
  word.dataset.liquidOn = '1';
  canvas.className = 'liquid-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  frame.appendChild(canvas);

  const vertex = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
  const fragment = [
    'precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform float t;uniform vec2 k;uniform float amp;uniform float reveal;',
    'void main(){',
    '  float T=6.2831853*t/5.;',
    '  vec2 q=uv;',
    '  float dx=sin(q.y*14.+q.x*3.+T)*.6+sin(q.y*27.-q.x*5.-2.*T)*.3+sin(q.y*41.+3.*T)*.1;',
    '  float dy=sin(q.x*11.+T)*.6+sin(q.x*23.-q.y*4.-2.*T)*.3+sin(q.x*37.+q.y*6.+3.*T)*.1;',
    '  q+=amp*vec2(dx*k.x,dy*k.y);',
    '  float edge=1.-smoothstep(reveal-.16,reveal,uv.x+dy*.035);',
    '  gl_FragColor=texture2D(tex,q)*edge;',
    '}'
  ].join('\n');
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    canvas.remove();
    root.classList.remove('liquid-ready');
    return;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(wrap => gl.texParameteri(gl.TEXTURE_2D, wrap, gl.CLAMP_TO_EDGE));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const uTime = gl.getUniformLocation(program, 't');
  const uK = gl.getUniformLocation(program, 'k');
  const uAmp = gl.getUniformLocation(program, 'amp');
  const uReveal = gl.getUniformLocation(program, 'reveal');
  const paper = document.createElement('canvas');
  const ink = paper.getContext('2d');

  // Paint every letter exactly where the DOM laid it out, on the word's baseline.
  function paint() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const frameBox = frame.getBoundingClientRect();
    const box = word.getBoundingClientRect();
    const big = parseFloat(getComputedStyle(word).fontSize);
    const pad = Math.round(big * .22);
    const width = box.width + pad * 2;
    const height = box.height + pad * 2;
    Object.assign(canvas.style, {left: box.left - frameBox.left - pad + 'px', top: box.top - frameBox.top - pad + 'px', width: width + 'px', height: height + 'px'});
    canvas.width = paper.width = Math.round(width * ratio);
    canvas.height = paper.height = Math.round(height * ratio);
    ink.setTransform(ratio, 0, 0, ratio, 0, 0);
    ink.clearRect(0, 0, width, height);
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    word.appendChild(probe);
    const baseline = probe.getBoundingClientRect().top - box.top + pad;
    probe.remove();
    const style = getComputedStyle(word);
    ink.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
    // Liquid words are transparent in the DOM (kept for screen readers), so take the colour from their line.
    ink.fillStyle = 'liquid' in word.dataset ? getComputedStyle(word.parentElement).color : style.color;
    ink.textBaseline = 'alphabetic';
    word.querySelectorAll('.char, .lq-ch').forEach(char => {
      const rect = char.getBoundingClientRect();
      ink.fillText(char.textContent, rect.left - box.left + pad, baseline);
    });
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paper);
    // Amplitude in uv units: about 7% of the word's size sideways and 11% up and down.
    gl.uniform2f(uK, big * .07 / width, big * .11 / height);
  }

  let start = 0;
  let raf = 0;
  let running = false;
  // Intro: the word pours in left to right on a wavy edge, rippling hard, then settles into the loop.
  const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  function draw(now) {
    if (!start) start = now;
    const elapsed = (now - start) / 1000;
    gl.uniform1f(uTime, elapsed % 5);
    gl.uniform1f(uReveal, -.2 + 1.45 * ease((elapsed - delay) / 1.1));
    gl.uniform1f(uAmp, 1 + 1.9 * (1 - ease((elapsed - delay) / 1.9)));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = running ? requestAnimationFrame(draw) : 0;
  }
  function play(on) {
    if (on === running) return;
    running = on;
    if (on) raf = requestAnimationFrame(draw);
    else cancelAnimationFrame(raf);
  }
  paint();
  frame.classList.add('lq-on');
  play(true);
  new IntersectionObserver(entries => play(entries[0].isIntersecting && !reduceMotion.matches)).observe(watch);
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(paint, 150);
  });
  reduceMotion.addEventListener('change', () => {
    play(!reduceMotion.matches);
    frame.classList.toggle('lq-on', !reduceMotion.matches);
    root.classList.toggle('liquid-ready', !reduceMotion.matches);
  });
}
function scheduleLiquid() {
  if (!hero || !root.classList.contains('liquid-ready')) return;
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => createLiquid(hero.querySelector('.hero-second'), hero.querySelector('h1'), hero, .3));
}
// Other liquid words split into letters now (so layout never shifts) and start when they come into view.
document.querySelectorAll('[data-liquid]').forEach(word => {
  const text = word.textContent;
  word.textContent = '';
  [...text].forEach(character => {
    const letter = document.createElement('span');
    letter.className = 'lq-ch';
    letter.textContent = character === ' ' ? '\u00a0' : character;
    word.appendChild(letter);
  });
});

/* Intro: start only once the page is loaded and actually visible (apps often load pages off-screen). */
const root = document.documentElement;
// The big word goes straight to the liquid canvas when WebGL is there, so it never sits still first.
if (!reduceMotion.matches) {
  try {
    if (document.createElement('canvas').getContext('webgl')) root.classList.add('liquid-ready');
  } catch (error) { /* no WebGL: the word keeps its letter intro */ }
}
let pageLoaded = document.readyState === 'complete';
let heroSeen = !hero || !('IntersectionObserver' in window);
function startIntro() {
  if (!root.classList.contains('intro-wait')) return;
  root.classList.remove('intro-wait');
  scheduleLiquid();
}
function maybeStartIntro() {
  if (pageLoaded && heroSeen && document.visibilityState === 'visible') setTimeout(startIntro, 300);
}
window.addEventListener('load', () => { pageLoaded = true; maybeStartIntro(); });
document.addEventListener('visibilitychange', maybeStartIntro);
if (!heroSeen) {
  const introObserver = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    heroSeen = true;
    introObserver.disconnect();
    maybeStartIntro();
  });
  introObserver.observe(hero);
}
maybeStartIntro();
setTimeout(startIntro, 6000); // never leave the hero paused

/* Header turns into a glass bar once the page leaves the very top. */
const siteHeader = document.querySelector('.header');
const headerState = () => siteHeader.classList.toggle('is-scrolled', window.scrollY > 24);
window.addEventListener('scroll', headerState, {passive: true});
headerState();

/* Mobile menu */
const menuButton = document.querySelector('.menu-toggle');
const menu = document.querySelector('#mobile-menu');
function closeMenu(restoreFocus = false) {
  menu.hidden = true;
  document.body.classList.remove('menu-open');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Открыть меню');
  if (restoreFocus) menuButton.focus();
}
menuButton.addEventListener('click', () => {
  if (menuButton.getAttribute('aria-expanded') === 'true') {
    closeMenu(true);
    return;
  }
  menu.hidden = false;
  document.body.classList.add('menu-open');
  menuButton.setAttribute('aria-expanded', 'true');
  menuButton.setAttribute('aria-label', 'Закрыть меню');
  menu.querySelector('a').focus({preventScroll: true});
});
menu.querySelectorAll('a').forEach(link => link.addEventListener('click', () => closeMenu()));
document.addEventListener('click', event => {
  if (!menu.hidden && !event.target.closest('.header')) closeMenu();
});
document.addEventListener('keydown', event => {
  if (menu.hidden) return;
  if (event.key === 'Escape') {
    closeMenu(true);
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [menuButton, ...menu.querySelectorAll('a')];
  const index = focusable.indexOf(document.activeElement);
  if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === focusable.length - 1)) {
    event.preventDefault();
    focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
  }
});
window.matchMedia('(min-width:768px)').addEventListener('change', event => {
  if (event.matches) closeMenu();
});

/* Before / after sliders. Each one runs a single short hint the first time it is seen. */
const sliders = [...document.querySelectorAll('.compare:not(.is-static)')].map(compare => {
  const range = compare.querySelector('.compare-range');
  const tagBefore = compare.querySelector('.compare-tag.is-before');
  const tagAfter = compare.querySelector('.compare-tag.is-after');
  const state = {compare, touched: false, frame: 0};
  state.set = value => {
    const clamped = Math.max(0, Math.min(100, Number(value)));
    range.value = clamped;
    compare.style.setProperty('--pos', clamped + '%');
    range.setAttribute('aria-valuetext', Math.round(clamped) + '% до, ' + Math.round(100 - clamped) + '% после');
    tagBefore.classList.toggle('is-faded', clamped < 16);
    tagAfter.classList.toggle('is-faded', clamped > 84);
  };
  state.stop = () => {
    state.touched = true;
    cancelAnimationFrame(state.frame);
  };
  // Moves the divider through [time ms, position %] points, smoothstep between them; any touch cancels it.
  state.tween = points => {
    cancelAnimationFrame(state.frame);
    const end = points[points.length - 1][0];
    if (reduceMotion.matches) return state.set(points[points.length - 1][1]);
    let start;
    const frame = now => {
      if (start === undefined) start = now;
      const elapsed = Math.min(now - start, end);
      let segment = 0;
      while (segment < points.length - 2 && elapsed > points[segment + 1][0]) segment++;
      const [t0, v0] = points[segment];
      const [t1, v1] = points[segment + 1];
      const t = Math.min(1, (elapsed - t0) / (t1 - t0));
      state.set(v0 + (v1 - v0) * (t * t * (3 - 2 * t)));
      if (elapsed < end) state.frame = requestAnimationFrame(frame);
    };
    state.frame = requestAnimationFrame(frame);
  };
  state.hint = () => {
    if (reduceMotion.matches || state.touched) return;
    state.tween([[0, 50], [500, 26], [1300, 72], [1900, 50]]);
  };
  range.addEventListener('pointerdown', () => {
    state.stop();
    compare.classList.add('active');
  });
  range.addEventListener('pointercancel', () => compare.classList.remove('active'));
  range.addEventListener('focus', state.stop);
  range.addEventListener('input', () => {
    state.stop();
    state.set(range.value);
  });
  return state;
});
window.addEventListener('pointerup', () => sliders.forEach(slider => slider.compare.classList.remove('active')));

/* Before / after catalogue: tabs pick the service (home) or the format (cleaning page), thumbnails pick the case.
   The next pair is decoded first, then the old one dissolves over it and the divider slides from «до» to the middle.
   With a mouse the divider follows the pointer across the stage. */
document.querySelectorAll('[data-ba]').forEach(viewer => {
  const stage = viewer.querySelector('.ba-stage');
  const slider = sliders.find(item => item.compare === stage);
  const range = stage.querySelector('.compare-range');
  const afterImg = stage.querySelector('.ba-after');
  const beforeLayer = stage.querySelector('.compare-before');
  const beforeImg = beforeLayer.querySelector('.ba-before');
  const caption = viewer.querySelector('.ba-caption');
  const more = caption.querySelector('.ba-more');
  const groupList = viewer.querySelector('.ba-groups');
  const groupTabs = groupList ? [...groupList.querySelectorAll('[role=tab]')] : [];
  const pill = groupList ? groupList.querySelector('.ba-groups-pill') : null;
  const caseLists = [...viewer.querySelectorAll('.ba-cases')];
  const prefix = afterImg.getAttribute('src').split('assets/ba/')[0];
  const files = (button, kind) => {
    const base = prefix + 'assets/ba/' + button.dataset.slug + '/' + button.dataset.n + '-' + kind;
    return {srcset: base + '-960.webp 960w, ' + base + '.webp 1920w', src: base + '-960.webp'};
  };
  let current = caseLists[0].querySelector('[aria-selected=true]');
  let token = 0;
  let captionTimer = 0;

  // Same sizes as the stage, so the browser picks the same file and the swap comes straight from cache.
  function load(button) {
    return Promise.all(['after', 'before'].map(kind => {
      const probe = new Image();
      probe.sizes = afterImg.sizes;
      Object.assign(probe, files(button, kind));
      return probe.decode().catch(() => {});
    }));
  }

  function swapCaption(button) {
    const tab = groupTabs.find(item => item.getAttribute('aria-selected') === 'true');
    const apply = () => {
      caption.querySelector('h3').textContent = button.dataset.title;
      caption.querySelector('p').textContent = button.dataset.text;
      if (more && tab && tab.dataset.href) {
        more.href = tab.dataset.href;
        more.firstChild.textContent = tab.dataset.more + ' ';
      }
      caption.classList.remove('is-swapping');
    };
    clearTimeout(captionTimer);
    if (reduceMotion.matches) return apply();
    caption.classList.add('is-swapping');
    captionTimer = setTimeout(apply, 220);
  }

  function select(button) {
    if (button === current) return;
    caseLists.forEach(list => list.querySelectorAll('[role=tab]').forEach(tab => {
      const on = tab === button;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }));
    current = button;
    stopFollow();
    const mine = ++token;
    load(button).then(() => {
      if (mine !== token) return;
      const motion = !reduceMotion.matches;
      if (motion) {
        // The old pair, frozen as it was, fades out above the new one.
        const ghost = document.createElement('div');
        ghost.className = 'ba-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.setProperty('--pos', range.value + '%');
        const oldAfter = afterImg.cloneNode();
        oldAfter.alt = '';
        const oldBefore = beforeLayer.cloneNode(true);
        oldBefore.querySelector('img').alt = '';
        ghost.append(oldAfter, oldBefore);
        stage.insertBefore(ghost, stage.querySelector('.compare-tag'));
        requestAnimationFrame(() => requestAnimationFrame(() => ghost.classList.add('is-out')));
        setTimeout(() => ghost.remove(), 1300);
      }
      [[afterImg, 'after', 'altAfter'], [beforeImg, 'before', 'altBefore']].forEach(([img, kind, alt]) => {
        Object.assign(img, files(button, kind));
        img.alt = button.dataset[alt];
      });
      swapCaption(button);
      if (motion) slider.tween([[0, 100], [300, 100], [1500, 50]]);
      else slider.set(50);
    });
  }

  function placePill(instant = false) {
    const tab = groupTabs.find(item => item.getAttribute('aria-selected') === 'true');
    if (instant) pill.style.transition = 'none';
    pill.style.setProperty('--x', tab.offsetLeft + 'px');
    pill.style.setProperty('--w', tab.offsetWidth + 'px');
    if (instant) {
      void pill.offsetWidth;
      pill.style.transition = '';
    }
    groupList.classList.add('is-ready');
  }

  function selectGroup(index) {
    groupTabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    caseLists.forEach((list, i) => { list.hidden = i !== index; });
    placePill();
    const tab = groupTabs[index];
    if (groupList.scrollWidth > groupList.clientWidth) {
      groupList.scrollTo({left: tab.offsetLeft - (groupList.clientWidth - tab.offsetWidth) / 2, behavior: reduceMotion.matches ? 'auto' : 'smooth'});
    }
    select(caseLists[index].querySelector('[role=tab]'));
  }

  // Arrow keys move along a row of tabs and pick right away.
  function arrowKeys(list, tabs, pick) {
    list.addEventListener('keydown', event => {
      const keys = {ArrowRight: 1, ArrowLeft: -1};
      const index = tabs.indexOf(document.activeElement);
      if (!(event.key in keys) || index < 0) return;
      event.preventDefault();
      const next = (index + keys[event.key] + tabs.length) % tabs.length;
      pick(next);
      tabs[next].focus();
    });
  }

  caseLists.forEach(list => {
    const tabs = [...list.querySelectorAll('[role=tab]')];
    tabs.forEach(tab => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('pointerenter', () => load(tab), {once: true});
    });
    arrowKeys(list, tabs, i => select(tabs[i]));
  });
  if (groupList) {
    groupTabs.forEach((tab, i) => {
      tab.addEventListener('click', () => { if (tab.getAttribute('aria-selected') !== 'true') selectGroup(i); });
      tab.addEventListener('pointerenter', () => load(caseLists[i].querySelector('[role=tab]')), {once: true});
    });
    arrowKeys(groupList, groupTabs, selectGroup);
    groupList.hidden = false;
    placePill(true);
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => placePill(true));
    window.addEventListener('resize', () => placePill(true));
  }
  viewer.querySelector('.ba-nav').hidden = false;

  // Mouse: the divider eases towards the pointer.
  const followPointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let followTarget = 50;
  let followFrame = 0;
  function followStep() {
    const now = Number(range.value);
    const next = now + (followTarget - now) * .22;
    slider.set(Math.abs(followTarget - next) < .05 ? followTarget : next);
    followFrame = Math.abs(followTarget - next) < .05 ? 0 : requestAnimationFrame(followStep);
  }
  function stopFollow() {
    cancelAnimationFrame(followFrame);
    followFrame = 0;
  }
  stage.addEventListener('pointermove', event => {
    if (!followPointer.matches || event.pointerType !== 'mouse' || event.buttons || reduceMotion.matches) return;
    const rect = stage.getBoundingClientRect();
    followTarget = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100));
    slider.stop();
    if (!followFrame) followFrame = requestAnimationFrame(followStep);
  });
  range.addEventListener('pointerdown', stopFollow);
});

/* Works: tabs on phones, a triptych on wider screens. */
const works = document.querySelector('.works');
const tabList = works ? works.querySelector('.works-tabs') : null;
if (tabList) {
  const tabs = [...tabList.querySelectorAll('[role=tab]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  function selectTab(index, focus = false) {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[i].classList.toggle('is-active', selected);
    });
    tabList.style.setProperty('--tab', index);
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(index));
    tab.addEventListener('keydown', event => {
      const keys = {ArrowRight: 1, ArrowLeft: -1};
      if (event.key in keys) {
        event.preventDefault();
        selectTab((index + keys[event.key] + tabs.length) % tabs.length, true);
      }
    });
  });
  tabList.hidden = false;
  works.classList.add('is-tabbed');
}

/* Service variants: polish level and ceramic layers. */
document.querySelectorAll('.svc-switch').forEach(group => {
  const options = [...group.querySelectorAll('[role=radio]')];
  const text = group.parentElement.querySelector('.svc-text');
  let swapTimer = 0;
  function choose(index, focus = false) {
    options.forEach((option, i) => {
      option.setAttribute('aria-checked', String(i === index));
      option.tabIndex = i === index ? 0 : -1;
    });
    if (focus) options[index].focus();
    const next = options[index].dataset.text;
    if (text.textContent === next) return;
    clearTimeout(swapTimer);
    if (reduceMotion.matches) {
      text.textContent = next;
      return;
    }
    text.classList.add('is-swapping');
    swapTimer = setTimeout(() => {
      text.textContent = next;
      text.classList.remove('is-swapping');
    }, 200);
  }
  options.forEach((option, index) => {
    option.tabIndex = option.getAttribute('aria-checked') === 'true' ? 0 : -1;
    option.addEventListener('click', () => choose(index));
    option.addEventListener('keydown', event => {
      const keys = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1};
      if (event.key in keys) {
        event.preventDefault();
        choose((index + keys[event.key] + options.length) % options.length, true);
      }
    });
  });
});

/* A service tile pre-selects the service in the form; the visitor never has to pick it. */
const serviceInput = document.querySelector('#service');
const chosen = document.querySelector('.booking-chosen');
const chosenLabel = document.querySelector('#service-label');
function setService(name) {
  serviceInput.value = name;
  chosenLabel.textContent = name;
  chosen.hidden = !name;
}
document.querySelector('.booking-chosen-clear')?.addEventListener('click', () => {
  setService('');
  document.querySelector('#name').focus();
});

/* Services stories: auto-advance every 5s while in view, tap left/right or swipe to move, hold to pause. */
const stories = document.querySelector('[data-stories]');
if (stories) {
  const storySlides = [...stories.querySelectorAll('.story')];
  const storyBars = [...stories.querySelectorAll('.stories-bars span')];
  const storyChips = [...stories.querySelectorAll('.stories-list button')];
  const storyList = stories.querySelector('.stories-list');
  let storyIndex = 0;
  let storyInView = false;
  let storyHeld = false;
  function syncStories() {
    stories.classList.toggle('is-paused', !storyInView || storyHeld || reduceMotion.matches);
  }
  function showStory(index) {
    storyIndex = (index + storySlides.length) % storySlides.length;
    storySlides.forEach((slide, i) => {
      const active = i === storyIndex;
      slide.classList.toggle('is-active', active);
      slide.inert = !active;
      slide.querySelector('h3').classList.remove('is-in');
    });
    storyBars.forEach((bar, i) => {
      bar.classList.toggle('is-done', i < storyIndex);
      bar.classList.remove('is-active');
    });
    storyChips.forEach(chip => chip.setAttribute('aria-current', 'false'));
    void stories.offsetWidth; // restart the progress and the title rise
    storyBars[storyIndex].classList.add('is-active');
    storyChips[storyIndex].setAttribute('aria-current', 'true');
    storySlides[storyIndex].querySelector('h3').classList.add('is-in');
    const chip = storyChips[storyIndex];
    if (storyList.scrollWidth > storyList.clientWidth) {
      storyList.scrollTo({left: chip.offsetLeft - (storyList.clientWidth - chip.offsetWidth) / 2, behavior: reduceMotion.matches ? 'auto' : 'smooth'});
    }
    syncStories();
  }
  stories.querySelector('.stories-bars').addEventListener('animationend', event => {
    if (event.target.parentElement === storyBars[storyIndex]) showStory(storyIndex + 1);
  });
  stories.querySelector('.story-tap.is-prev').addEventListener('click', () => showStory(storyIndex - 1));
  stories.querySelector('.story-tap.is-next').addEventListener('click', () => showStory(storyIndex + 1));
  storyChips.forEach((chip, i) => chip.addEventListener('click', () => showStory(i)));
  // Desktop: pointing at a service shows it; the slideshow waits while the pointer is over the list.
  const storyHover = window.matchMedia('(min-width: 1024px) and (hover: hover)');
  let storyHoverTimer = 0;
  storyChips.forEach((chip, i) => chip.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse' || !storyHover.matches) return;
    clearTimeout(storyHoverTimer);
    storyHoverTimer = setTimeout(() => { if (i !== storyIndex) showStory(i); }, 120);
  }));
  storyList.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse' || !storyHover.matches) return;
    storyHeld = true;
    syncStories();
  });
  storyList.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(storyHoverTimer);
    storyHeld = false;
    syncStories();
  });
  // Hold to pause; a horizontal swipe moves between services.
  const stage = stories.querySelector('.stories-stage');
  let swipeX = null;
  let swipeY = 0;
  stage.addEventListener('pointerdown', event => {
    storyHeld = true;
    swipeX = event.clientX;
    swipeY = event.clientY;
    syncStories();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => stage.addEventListener(type, event => {
    if (type === 'pointerup' && swipeX !== null) {
      const dx = event.clientX - swipeX;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(event.clientY - swipeY)) {
        showStory(storyIndex + (dx < 0 ? 1 : -1));
        stage.dataset.swiped = '1';
        setTimeout(() => delete stage.dataset.swiped, 0);
      }
    }
    swipeX = null;
    storyHeld = false;
    syncStories();
  }));
  stage.addEventListener('click', event => {
    if (stage.dataset.swiped) event.stopPropagation();
  }, true);
  stories.addEventListener('focusin', () => { storyHeld = true; syncStories(); });
  stories.addEventListener('focusout', event => {
    if (stories.contains(event.relatedTarget)) return;
    storyHeld = false;
    syncStories();
  });
  reduceMotion.addEventListener('change', syncStories);
  showStory(0);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      storyInView = entries[0].isIntersecting;
      syncStories();
    }, {threshold: .5}).observe(stage);
  } else {
    storyInView = true;
    syncStories();
  }
}

/* FAQ: answers open and close smoothly by height; one open at a time. */
const faqItems = [...document.querySelectorAll('.faq-list details')];
faqItems.forEach(item => item.removeAttribute('name')); // exclusivity handled here, with animation
function faqAnimate(item, open) {
  const summary = item.querySelector('summary');
  const from = item.offsetHeight;
  if (open) item.open = true;
  const to = open ? item.offsetHeight : summary.offsetHeight;
  item.style.overflow = 'hidden';
  const animation = item.animate({height: [from + 'px', to + 'px']}, {duration: open ? 560 : 420, easing: 'cubic-bezier(.16,1,.3,1)'});
  animation.onfinish = () => {
    if (!open) item.open = false;
    item.style.overflow = '';
  };
}
faqItems.forEach(item => item.querySelector('summary').addEventListener('click', event => {
  if (reduceMotion.matches) return;
  event.preventDefault();
  const opening = !item.open;
  faqItems.forEach(other => { if (other !== item && other.open) faqAnimate(other, false); });
  faqAnimate(item, opening);
}));

/* Finished cars: drag the next car into the studio. The new car follows the finger behind a vertical line of light;
   release past a third (or flick) and it drives all the way in, otherwise it slides back. Auto-advances until touched. */
const bay = document.querySelector('[data-bay]');
if (bay) {
  const bayStage = bay.querySelector('.bay-stage');
  const bayShots = [...bay.querySelectorAll('.bay-shot')];
  const bayName = bay.querySelector('.bay-name span');
  const bayCount = bayShots.length;
  let bayIndex = 0;
  let bayBusy = false;
  let bayTimer = 0;
  let bayAuto = true;
  let bayInView = false;
  let bayHinted = false;
  const bayEase = x => 1 - Math.pow(1 - x, 4);
  const bayWide = window.matchMedia('(min-width: 1024px)'); // desktop: a row of cars instead of one stage

  function bayPrepare(index, dir) {
    bayShots.forEach(shot => shot.classList.remove('is-next', 'is-prev'));
    const shot = bayShots[index];
    shot.classList.add(dir > 0 ? 'is-next' : 'is-prev');
    return {index, dir, shot};
  }
  function bayRender(move, progress) {
    const cut = (1 - progress) * 100;
    move.shot.style.setProperty('--cut', cut + '%');
    bayStage.style.setProperty('--edge', (move.dir > 0 ? cut : 100 - cut) + '%');
  }
  function bayTween(move, from, to, duration, done) {
    const start = performance.now();
    const step = now => {
      const k = Math.min(1, (now - start) / duration);
      bayRender(move, from + (to - from) * bayEase(k));
      if (k < 1) requestAnimationFrame(step);
      else if (done) done();
    };
    requestAnimationFrame(step);
  }
  function bayMeta() {
    bayName.classList.remove('is-in');
    void bayName.offsetWidth;
    bayName.textContent = bayShots[bayIndex].dataset.name;
    bayName.classList.add('is-in');
  }
  function bayCommit(move) {
    bayShots[bayIndex].classList.remove('is-active');
    move.shot.classList.remove('is-next', 'is-prev');
    move.shot.style.removeProperty('--cut');
    move.shot.classList.add('is-active');
    bayIndex = move.index;
    bayStage.classList.remove('is-moving', 'is-dragging');
    bayBusy = false;
    bayMeta();
  }
  function bayCancel(move) {
    move.shot.classList.remove('is-next', 'is-prev');
    move.shot.style.removeProperty('--cut');
    bayStage.classList.remove('is-moving', 'is-dragging');
    bayBusy = false;
  }
  function bayGo(index, dir) {
    if (bayWide.matches) return;
    index = (index + bayCount) % bayCount;
    if (bayBusy || index === bayIndex) return;
    bayBusy = true;
    const move = bayPrepare(index, dir);
    if (reduceMotion.matches) return bayCommit(move);
    bayStage.classList.add('is-moving');
    bayTween(move, 0, 1, 950, () => bayCommit(move));
  }
  function bayScheduleAuto() {
    clearTimeout(bayTimer);
    if (bayAuto && bayInView && !reduceMotion.matches && !bayWide.matches) bayTimer = setTimeout(() => { bayGo(bayIndex + 1, 1); bayScheduleAuto(); }, 4500);
  }
  function bayTakeOver() {
    bayAuto = false;
    bay.classList.add('is-touched');
    clearTimeout(bayTimer);
  }
  // One gentle peek the first time the stage is seen: the next car slides in a little and back.
  function bayHint() {
    if (bayHinted || reduceMotion.matches || bayBusy || bayWide.matches) return;
    bayHinted = true;
    bayBusy = true;
    const move = bayPrepare((bayIndex + 1) % bayCount, 1);
    bayStage.classList.add('is-moving');
    bayTween(move, 0, .24, 700, () => setTimeout(() => bayTween(move, .24, 0, 600, () => bayCancel(move)), 250));
  }


  // Drag: horizontal moves are ours (touch-action: pan-y keeps vertical scrolling native).
  let bayDrag = null;
  bayStage.addEventListener('pointerdown', event => {
    if (bayBusy || bayWide.matches) return;
    bayDrag = {x: event.clientX, y: event.clientY, started: false, move: null, progress: 0, lastX: event.clientX, lastT: performance.now(), v: 0};
  });
  bayStage.addEventListener('pointermove', event => {
    if (!bayDrag) return;
    const dx = event.clientX - bayDrag.x;
    const dy = event.clientY - bayDrag.y;
    if (!bayDrag.started) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { bayDrag = null; return; }
      bayDrag.started = true;
      bayTakeOver();
      try { bayStage.setPointerCapture(event.pointerId); } catch (error) { /* synthetic or already released pointer */ }
      bayStage.classList.add('is-dragging');
    }
    const dir = dx < 0 ? 1 : -1;
    if (!bayDrag.move || bayDrag.move.dir !== dir) bayDrag.move = bayPrepare((bayIndex + dir + bayCount) % bayCount, dir);
    bayDrag.progress = Math.min(1, Math.abs(dx) / (bayStage.clientWidth * .8));
    bayRender(bayDrag.move, bayDrag.progress);
    const now = performance.now();
    bayDrag.v = (event.clientX - bayDrag.lastX) / Math.max(1, now - bayDrag.lastT);
    bayDrag.lastX = event.clientX;
    bayDrag.lastT = now;
  });
  function bayRelease() {
    if (!bayDrag) return;
    const drag = bayDrag;
    bayDrag = null;
    if (!drag.started || !drag.move) return;
    const flick = Math.abs(drag.v) > .45 && Math.sign(-drag.v) === drag.move.dir;
    bayBusy = true;
    bayStage.classList.remove('is-dragging');
    bayStage.classList.add('is-moving');
    if (drag.progress > .3 || flick) bayTween(drag.move, drag.progress, 1, 220 + 420 * (1 - drag.progress), () => bayCommit(drag.move));
    else bayTween(drag.move, drag.progress, 0, 320, () => bayCancel(drag.move));
  }
  bayStage.addEventListener('pointerup', bayRelease);
  bayStage.addEventListener('pointercancel', bayRelease);

  bayStage.tabIndex = 0;
  bayStage.addEventListener('keydown', event => {
    const keys = {ArrowRight: 1, ArrowLeft: -1};
    if (!(event.key in keys)) return;
    event.preventDefault();
    bayTakeOver();
    if (bayWide.matches) railStep(keys[event.key]);
    else bayGo(bayIndex + keys[event.key], keys[event.key]);
  });

  /* Desktop row: arrows step one car, the mouse drags the row, the counter and bar follow the scroll,
     and each photo drifts a little inside its frame (parallax) as the row moves. */
  const bayCountLabel = document.querySelector('.bay-count b');
  const bayArrows = [...document.querySelectorAll('.bay-arrow')];
  const bayThumb = bay.querySelector('.bay-progress i');
  const railGap = () => parseFloat(getComputedStyle(bayStage).columnGap) || 0;
  const railStepSize = () => bayShots[0].offsetWidth + railGap();
  function railStep(dir) {
    bayStage.scrollBy({left: dir * railStepSize(), behavior: reduceMotion.matches ? 'auto' : 'smooth'});
  }
  let railFrame = 0;
  function railSync() {
    railFrame = 0;
    if (!bayWide.matches) return;
    const max = bayStage.scrollWidth - bayStage.clientWidth;
    const progress = max > 0 ? bayStage.scrollLeft / max : 0;
    const index = progress > .995 ? bayCount - 1 : Math.round(bayStage.scrollLeft / railStepSize());
    bayCountLabel.textContent = String(index + 1).padStart(2, '0');
    bayArrows[0].disabled = bayStage.scrollLeft < 4;
    bayArrows[1].disabled = bayStage.scrollLeft > max - 4;
    const visible = Math.min(1, bayStage.clientWidth / bayStage.scrollWidth);
    bayThumb.style.setProperty('--thumb', (visible * 100).toFixed(2) + '%');
    bayThumb.style.setProperty('--shift', (progress * (1 - visible) / visible * 100).toFixed(2) + '%');
    if (reduceMotion.matches) return;
    const box = bayStage.getBoundingClientRect();
    bayShots.forEach(shot => {
      const rect = shot.getBoundingClientRect();
      const offset = (rect.left + rect.width / 2 - (box.left + box.width / 2)) / box.width;
      shot.style.setProperty('--px', (Math.max(-1, Math.min(1, offset)) * -4).toFixed(2) + '%');
    });
  }
  const railQueue = () => { if (!railFrame) railFrame = requestAnimationFrame(railSync); };
  bayStage.addEventListener('scroll', railQueue, {passive: true});
  window.addEventListener('resize', railQueue);
  bayArrows.forEach(button => button.addEventListener('click', () => railStep(Number(button.dataset.dir))));
  // Mouse drag along the row (touch and trackpads scroll it natively).
  let railDrag = null;
  bayStage.addEventListener('pointerdown', event => {
    if (!bayWide.matches || event.pointerType !== 'mouse' || event.button !== 0) return;
    railDrag = {x: event.clientX, left: bayStage.scrollLeft, moved: false};
  });
  window.addEventListener('pointermove', event => {
    if (!railDrag) return;
    const dx = event.clientX - railDrag.x;
    if (!railDrag.moved) {
      if (Math.abs(dx) < 5) return;
      railDrag.moved = true;
      bayStage.classList.add('is-grabbing');
    }
    bayStage.scrollLeft = railDrag.left - dx;
  });
  window.addEventListener('pointerup', () => {
    if (!railDrag) return;
    const moved = railDrag.moved;
    railDrag = null;
    if (!moved) return;
    const step = railStepSize();
    bayStage.scrollTo({left: Math.round(bayStage.scrollLeft / step) * step, behavior: reduceMotion.matches ? 'auto' : 'smooth'});
    setTimeout(() => bayStage.classList.remove('is-grabbing'), 450);
  });
  // Switching between phone stage and desktop row resets whichever mode is left behind.
  bayWide.addEventListener('change', () => {
    clearTimeout(bayTimer);
    bayShots.forEach(shot => {
      shot.classList.remove('is-next', 'is-prev');
      shot.style.removeProperty('--cut');
    });
    bayStage.classList.remove('is-moving', 'is-dragging', 'is-grabbing');
    bayBusy = false;
    if (bayWide.matches) railSync();
    else {
      bayStage.scrollLeft = 0;
      bayScheduleAuto();
    }
  });
  railSync();
  bay.addEventListener('focusin', bayTakeOver);
  bay.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') clearTimeout(bayTimer); });
  bay.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') bayScheduleAuto(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      bayInView = entries[0].isIntersecting;
      if (bayInView) {
        setTimeout(bayHint, 1300);
        bayScheduleAuto();
      } else clearTimeout(bayTimer);
    }, {threshold: .6}).observe(bayStage);
  }
}

/* Booking form: name + phone, masked phone, inline errors, honest submit states. */
const form = document.querySelector('#booking-form');
if (form) {
  const nameInput = document.querySelector('#name');
  const phoneInput = document.querySelector('#phone');
  const submit = form.querySelector('.form-submit');
  const formStatus = document.querySelector('#form-status');
  const done = document.querySelector('#booking-done');
  // Set data-endpoint on the form (e.g. a Formspree URL or your own handler) to start receiving requests.
  const endpoint = form.dataset.endpoint || '';

  function phoneDigits(value) {
    let digits = value.replace(/\D/g, '');
    if (digits.startsWith('8')) digits = '7' + digits.slice(1);
    if (digits && !digits.startsWith('7')) digits = '7' + digits;
    return digits.slice(0, 11);
  }
  function formatPhone(digits) {
    if (!digits) return '';
    const d = digits.slice(1);
    let out = '+7';
    if (d.length) out += ' (' + d.slice(0, 3);
    if (d.length >= 3) out += ')';
    if (d.length > 3) out += ' ' + d.slice(3, 6);
    if (d.length > 6) out += '-' + d.slice(6, 8);
    if (d.length > 8) out += '-' + d.slice(8, 10);
    return out;
  }
  phoneInput.addEventListener('input', event => {
    if (event.inputType && event.inputType.startsWith('delete')) {
      clearError(phoneInput);
      return;
    }
    phoneInput.value = formatPhone(phoneDigits(phoneInput.value));
    clearError(phoneInput);
  });
  phoneInput.addEventListener('focus', () => {
    if (!phoneInput.value) phoneInput.value = '+7 (';
  });
  phoneInput.addEventListener('blur', () => {
    if (phoneDigits(phoneInput.value).length <= 1) phoneInput.value = '';
  });
  nameInput.addEventListener('input', () => clearError(nameInput));

  function showError(input, message) {
    input.setAttribute('aria-invalid', 'true');
    document.getElementById(input.id + '-error').textContent = message;
  }
  function clearError(input) {
    input.removeAttribute('aria-invalid');
    document.getElementById(input.id + '-error').textContent = '';
    formStatus.textContent = '';
  }
  function validate() {
    let firstInvalid = null;
    if (!nameInput.value.trim()) {
      showError(nameInput, 'Как к вам обращаться?');
      firstInvalid = nameInput;
    }
    if (phoneDigits(phoneInput.value).length !== 11) {
      showError(phoneInput, 'Введите номер полностью: +7 и 10 цифр.');
      firstInvalid = firstInvalid || phoneInput;
    }
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    formStatus.textContent = '';
    if (!validate()) return;
    if (!endpoint) {
      formStatus.textContent = 'Онлайн-запись подключается и скоро заработает. Спасибо за терпение!';
      return;
    }
    submit.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({name: nameInput.value.trim(), phone: formatPhone(phoneDigits(phoneInput.value)), service: serviceInput.value || 'Не выбрана'})
      });
      if (!response.ok) throw new Error(response.status);
      document.querySelector('#done-title').textContent = 'Спасибо, ' + nameInput.value.trim() + '!';
      document.querySelector('#done-text').textContent = 'Заявка у нас. Скоро перезвоним.';
      form.hidden = true;
      done.hidden = false;
      done.focus();
    } catch {
      formStatus.textContent = 'Не получилось отправить. Проверьте интернет и попробуйте ещё раз.';
    } finally {
      submit.removeAttribute('aria-busy');
    }
  });
  done.querySelector('.done-again').addEventListener('click', () => {
    form.reset();
    setService('');
    done.hidden = true;
    form.hidden = false;
    nameInput.focus();
  });
}

if (form && form.dataset.service) setService(form.dataset.service);

const year = document.querySelector('#year');
if (year) year.textContent = new Date().getFullYear();

if (hero) {
  // Tapping the car blinks the headlights right away.
  let igniteAt = 0;
  hero.querySelector('.hero-scene').style.pointerEvents = 'auto';
  hero.querySelector('.hero-scene').addEventListener('click', () => {
    if (reduceMotion.matches || root.classList.contains('intro-wait') || performance.now() - igniteAt < 1600) return;
    igniteAt = performance.now();
    heroImage.querySelectorAll('.car-lights, .car-flare').forEach(layer => layer.getAnimations().forEach(animation => {
      animation.cancel();
      animation.startTime = null;
      animation.currentTime = animation.effect.getTiming().delay;
      animation.play();
    }));
  });

  /* Pointer depth on the hero car: desktop only, one frame per pointer event. */
  let pointerFrame = 0;
  let pointerRect;
  let pointerX = 0;
  let pointerY = 0;
  hero.addEventListener('pointerenter', () => { pointerRect = hero.getBoundingClientRect(); });
  hero.addEventListener('pointermove', event => {
    if (reduceMotion.matches || !desktopPointer.matches || !pointerRect) return;
    pointerX = (event.clientX - pointerRect.left) / pointerRect.width - .5;
    pointerY = (event.clientY - pointerRect.top) / pointerRect.height - .5;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      heroImage.style.transform = `translate3d(${pointerX * 22}px, ${pointerY * 12}px, 0)`;
      pointerFrame = 0;
    });
  });
  function resetPointer() {
    cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    heroImage.style.transform = '';
  }
  hero.addEventListener('pointerleave', resetPointer);
  desktopPointer.addEventListener('change', resetPointer);
  reduceMotion.addEventListener('change', () => {
    sliders.forEach(slider => cancelAnimationFrame(slider.frame));
    resetPointer();
  });
}

/* Kinetic type: split headings into masked words (or letters) that rise in sequence when they enter the view. */
function splitKinetic(element) {
  const byChars = element.dataset.kinetic === 'chars';
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {acceptNode: node => node.parentElement.closest('[data-liquid]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let index = 0;
  nodes.forEach(node => {
    // Split on ordinary whitespace only, so a non-breaking space keeps «в деталях» together.
    const parts = byChars ? [...node.textContent] : node.textContent.split(/([ \t\n\r]+)/);
    const fragment = document.createDocumentFragment();
    parts.forEach(part => {
      if (!part) return;
      if (/^[ \t\n\r]+$/.test(part)) {
        fragment.appendChild(document.createTextNode(part));
        return;
      }
      const word = document.createElement('span');
      const inner = document.createElement('span');
      word.className = 'kw';
      inner.className = 'kw-in';
      inner.textContent = part;
      inner.style.setProperty('--i', index++);
      word.appendChild(inner);
      fragment.appendChild(word);
    });
    node.replaceWith(fragment);
  });
}
const kineticItems = [...document.querySelectorAll('[data-kinetic]')];
kineticItems.forEach(splitKinetic);

if (!('IntersectionObserver' in window)) {
  kineticItems.forEach(item => item.classList.add('is-in'));
}
if ('IntersectionObserver' in window) {
  const kineticObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      kineticObserver.unobserve(entry.target);
    });
  }, {threshold: .3, rootMargin: '0px 0px -8% 0px'});
  kineticItems.filter(item => !item.closest('.story')).forEach(item => kineticObserver.observe(item));



  // Other liquid words start the first time they are seen.
  document.querySelectorAll('[data-liquid]').forEach(word => {
    const liquidObserver = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting || !root.classList.contains('liquid-ready')) return;
      liquidObserver.disconnect();
      (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => createLiquid(word, word.closest('h2'), word.closest('section')));
    }, {threshold: .2});
    liquidObserver.observe(word);
  });


  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    });
  }, {threshold: .08, rootMargin: '0px 0px -40px 0px'});
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
  // A closed curtain has no visible area, so watch the media's parent and open the curtain from there.
  const curtainObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const grid = entry.target.closest('.works-grid');
      if (grid) {
        // All three works open together, so switching tabs later shows them already in place.
        grid.querySelectorAll('.reveal-media, figcaption.reveal').forEach(element => element.classList.add('visible'));
        grid.querySelectorAll('figcaption [data-kinetic]').forEach(element => element.classList.add('is-in'));
        grid.querySelectorAll('.work').forEach(work => curtainObserver.unobserve(work));
        return;
      }
      entry.target.querySelectorAll(':scope > .reveal-media').forEach(media => media.classList.add('visible'));
      curtainObserver.unobserve(entry.target);
    });
  }, {threshold: .12, rootMargin: '0px 0px -40px 0px'});
  new Set([...document.querySelectorAll('.reveal-media')].map(media => media.parentElement)).forEach(parent => curtainObserver.observe(parent));
  document.documentElement.classList.add('motion-ready');

  const hintObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const slider = sliders.find(item => item.compare === entry.target);
      setTimeout(() => slider.hint(), 450);
      hintObserver.unobserve(entry.target);
      // Phones show one work at a time: only the first one hints, the other tabs stay still.
      if (tabList && slider.compare.closest('.works') && !tabList.hidden && getComputedStyle(tabList).display !== 'none') {
        sliders.forEach(other => {
          if (other === slider || !other.compare.closest('.works')) return;
          other.touched = true;
          hintObserver.unobserve(other.compare);
        });
      }
    });
  }, {threshold: .55});
  sliders.forEach(slider => hintObserver.observe(slider.compare));

}
