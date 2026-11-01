export function defaultWardrobe() {
  return {
    body: 'default',
    glasses: 'none',
    bunny: false,
    basin: false,
    skirt: false,
    chest: false,
    shoes: false,
    tail: false,
    eyes: 'none',
    tears: false,
    darkFace: false,
    blush: false,
    sweat: false,
    loadingFace: false,
    lean: false,
  };
}

const BODIES = new Set(['default', 'type1', 'type2']);
const GLASSES = new Set(['none', 'frame', 'monocle']);
const EYES = new Set(['none', 'spiral', 'heart', 'shy', 'smug']);

export function normalizeWardrobe(input) {
  const base = defaultWardrobe();
  if (!input || typeof input !== 'object') return base;
  if (BODIES.has(input.body)) base.body = input.body;
  if (GLASSES.has(input.glasses)) base.glasses = input.glasses;
  if (EYES.has(input.eyes)) base.eyes = input.eyes;
  for (const key of ['bunny', 'basin', 'skirt', 'chest', 'shoes', 'tail', 'tears', 'darkFace', 'blush', 'sweat', 'loadingFace', 'lean']) {
    if (input[key] === true || input[key] === false) base[key] = input[key];
  }
  return base;
}

export const OUTFIT_CONTROLS = [
  { kind: 'choice', key: 'body', label: '体型', options: [['default', '默认'], ['type1', '体型1'], ['type2', '体型2']] },
  { kind: 'choice', key: 'glasses', label: '眼镜', options: [['none', '无'], ['frame', '黑框'], ['monocle', '单片']] },
  { kind: 'toggle', key: 'bunny', label: '兔牙' },
  { kind: 'toggle', key: 'basin', label: '钢盆' },
  { kind: 'toggle', key: 'skirt', label: '切换裙子' },
  { kind: 'toggle', key: 'chest', label: '胸口衣服' },
  { kind: 'toggle', key: 'shoes', label: '脱鞋' },
  { kind: 'toggle', key: 'tail', label: '收起尾巴' },
];

export const FACE_CONTROLS = [
  { kind: 'choice', key: 'eyes', label: '眼睛', options: [['none', '无'], ['spiral', '圈圈'], ['heart', '爱心'], ['shy', '＞＜'], ['smug', '屑屑']] },
  { kind: 'toggle', key: 'tears', label: '流泪' },
  { kind: 'toggle', key: 'darkFace', label: '黑脸' },
  { kind: 'toggle', key: 'blush', label: '脸红' },
  { kind: 'toggle', key: 'sweat', label: '流冷汗' },
  { kind: 'toggle', key: 'loadingFace', label: '加载' },
  { kind: 'toggle', key: 'lean', label: '前倾' },
];

export const MOTION_CONTROLS = [
  ['Hello', '打招呼'],
  ['Nod', '点头'],
  ['Shake', '摇头'],
  ['Stretch', '伸懒腰'],
  ['FingerOut', '竖指出来'],
  ['FingerBack', '竖指收回'],
  ['GrassOut', '狗尾草出来'],
  ['GrassBack', '狗尾草收回'],
  ['Escape', '脱捕'],
];

/** Absolute parameter targets. Work mode only overrides its own temporary keys. */
export function composeTargets(wardrobe, workMode = 'idle') {
  const look = normalizeWardrobe(wardrobe);
  const values = {
    // These three exp3 files use Blend Add. Clothes1/Clothes5 default to 1 and only accept 0..1, so Add -1 lands on 0.
    Clothes1: look.skirt ? 0 : 1,
    Clothes2: look.body === 'type1' ? 0.4 : look.body === 'type2' ? 1 : 0,
    Clothes3: look.chest ? 1 : 0,
    Clothes4: look.shoes ? 1 : 0,
    Clothes5: look.tail ? 0 : 1,
    key9: look.bunny ? 1 : 0,
    key10: look.basin ? 1 : 0,
    key11: look.glasses === 'frame' ? 1 : 0,
    key12: look.glasses === 'monocle' ? 1 : 0,
    key1: look.darkFace ? 1 : 0,
    key2: look.tears ? 1 : 0,
    key3: look.eyes === 'spiral' ? 1 : 0,
    key4: look.eyes === 'heart' ? 1 : 0,
    key5: look.eyes === 'shy' ? 1 : 0,
    key6: look.eyes === 'smug' ? 1 : 0,
    key7: look.blush ? 1 : 0,
    key8: look.loadingFace ? 1 : 0,
    key13: look.sweat ? 1 : 0,
    LeanInput: look.lean ? -30 : 0,
  };
  if (workMode === 'thinking') values.key8 = 1;
  if (workMode === 'answering') values.key7 = 1;
  if (workMode === 'error') values.key13 = 1;
  return values;
}
