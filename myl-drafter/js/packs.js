// Real booster pack wrappers, cut out of photos from the MyL fan wiki (myl.fandom.com) and blog.myl.cl,
// normalized to 300x500 WebP. Edition id -> number of wrapper designs (img/packs/<id>-<n>.webp).
// Sets missing here get a drawn wrapper with the edition logo.
export const PACK_ART = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 4, 10: 1, 11: 1, 13: 2, 15: 2, 16: 2, 18: 2, 19: 1, 20: 1, 29: 1, 31: 2, 35: 2, 36: 2, 38: 2, 40: 2, 42: 2, 43: 1, 44: 1, 51: 4, 52: 2, 57: 1, 65: 2, 68: 2, 72: 4, 73: 2, 75: 2, 76: 3, 87: 2, 88: 3, 93: 3, 98: 1, 109: 2, 112: 3, 114: 5, 116: 4, 123: 5, 151: 3, 154: 3, 161: 1 };
export const packImages = id => Array.from({ length: PACK_ART[id] || 0 }, (_, i) => `img/packs/${id}-${i + 1}.webp`);
