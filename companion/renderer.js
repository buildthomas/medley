// Window UI. Gets state from the main process (window.medley, see preload.cjs) and sends
// commands back. Progress is extrapolated locally between state updates.
const $ = (id) => document.getElementById(id);
const api = window.medley;

let state = null; // last "now playing" from Medley
let status = { state: 'connecting' };
let apps = 0; // browser tabs with Medley open on this channel

const fmt = (s) => {
  if (s == null || !Number.isFinite(s)) return '–:––';
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const position = () =>
  state ? Math.min(state.length ?? Infinity, state.position + (state.playing ? (Date.now() - state.at) / 1000 : 0)) : 0;

function show(view) {
  for (const id of ['player', 'message', 'setup']) $(id).hidden = id !== view;
}

function message(headline, detail) {
  $('headline').textContent = headline;
  $('detail').textContent = detail;
  show('message');
}

function render() {
  if (status.state === 'setup') {
    $('code').value = '';
    show('setup');
    $('code').focus();
    return;
  }
  if (status.state === 'connecting') return message('Connecting…', status.url ?? '');
  if (status.state === 'offline')
    return message('Can’t reach Medley', `${status.url} · ${status.error ?? 'offline'} · retrying`);
  if (!state || !state.title) {
    return message(
      apps ? 'Nothing playing' : 'Waiting for Medley',
      apps ? 'Press play in Medley, or hit ▶ here.' : 'Open Medley in your browser to see what’s playing here.',
    );
  }
  show('player');
  $('work').textContent = state.work ?? '';
  $('title').textContent = state.title;
  $('title').title = state.title;
  $('sub').textContent = [state.artist, state.next && `Next: ${state.next}`].filter(Boolean).join(' · ');
  $('toggle').textContent = state.playing ? '❚❚' : '▶';
  $('like').textContent = state.liked ? '♥' : '♡';
  $('like').classList.toggle('on', !!state.liked);
  const cover = $('cover');
  if (state.cover) {
    cover.style.backgroundImage = `url("${encodeURI(state.cover)}")`;
    $('cover-letter').textContent = '';
  } else {
    cover.style.backgroundImage = '';
    $('cover-letter').textContent = (state.work ?? '♪').slice(0, 1);
  }
  tick();
}

function tick() {
  if (!state) return;
  const p = position();
  $('bar-fill').style.width = state.length ? `${Math.min(100, (100 * p) / state.length)}%` : '0%';
  $('time').textContent = `${fmt(p)} / ${fmt(state.length)}`;
}
setInterval(tick, 500);

async function send(cmd) {
  const r = await api.command(cmd);
  if (!r.ok && r.error) {
    $('time').textContent = r.error;
  }
  // Feel instant: flip play/pause locally; Medley's next update confirms.
  if (r.ok && cmd === 'toggle' && state) {
    state = { ...state, position: position(), at: Date.now(), playing: !state.playing };
    render();
  }
}

api.onState((s) => {
  state = s;
  render();
});
api.onStatus((s) => {
  status = s;
  render();
});
api.onPresence((p) => {
  apps = p.apps;
  render();
});
api.onPinned((on) => $('pin').classList.toggle('on', on));

$('prev').onclick = () => send('prev');
$('toggle').onclick = () => send('toggle');
$('next').onclick = () => send('next');
$('like').onclick = () => send('like');
$('cover').onclick = () => api.window('open');
$('pin').onclick = () => api.window('pin');
$('settings').onclick = () => api.window('setup');
$('min').onclick = () => api.window('minimize');
$('close').onclick = () => api.window('close');
$('setup').onsubmit = async (e) => {
  e.preventDefault();
  const r = await api.connect($('code').value);
  $('setup-error').textContent = r.ok ? '' : r.error;
};

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) {
    if (e.key === 'Escape') api.window('reconnect');
    return;
  }
  if (e.key === ' ') send('toggle');
  else if (e.key === 'ArrowRight' || e.key === 'n') send('next');
  else if (e.key === 'ArrowLeft' || e.key === 'p') send('prev');
  else if (e.key === 'l') send('like');
  else return;
  e.preventDefault();
});

render();
