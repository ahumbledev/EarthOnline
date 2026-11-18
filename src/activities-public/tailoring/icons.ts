const wrap = (body: string, viewBox = '0 0 100 100') => `<svg viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
export const garmentIcon = (kind: string) => wrap(kind === 'jeans'
  ? '<path d="M28 10h44l5 78H56l-6-49-6 49H23z"/><path d="M28 20h44M50 11v28M29 25l12 2-2 14-12-2m44-14-12 2 2 14 12-2M28 81h16m12 0h16"/>'
  : kind === 'dress'
    ? '<path d="M37 8 24 24l9 9 6-7-3 24L17 89q33 8 66 0L64 50l-3-24 6 7 9-9L63 8q-13 15-26 0z"/><path d="M36 50h28M28 84q22 6 44 0M42 57l-5 25m21-25 5 25"/>'
    : '<path d="M35 12 12 29l13 20 12-7v44h26V42l12 7 13-20-23-17q-15 16-30 0z"/><path d="M35 12q15 24 30 0M38 78h24M16 34l12 19m44 0 12-19"/>');
export const scissorsIcon = wrap('<circle cx="21" cy="70" r="12"/><circle cx="43" cy="80" r="12"/><path d="m31 62 50-46-31 55M34 72l-8-57 24 56"/><circle cx="44" cy="57" r="3"/>');
export const needleIcon = wrap('<path d="M71 12 28 87q-3 5-1-1L62 9q5-10 9 3zM64 14l-5 11M65 17q32 3 14 25T54 61"/>');
export const spoolIcon = wrap('<path d="M32 19h36v62H32zM25 12h50v7H25zM25 81h50v7H25zM33 25l34 11m-34 0 34 11m-34 0 34 11m-34 0 34 11m-34 0 34 8"/>');
export const hangerIcon = wrap('<path d="M43 26c0-13 18-13 18 0 0 7-11 8-11 17v7L13 74q-5 5 2 5h70q7 0 2-5L50 50"/>');
export const starIcon = wrap('<path d="m50 12 10 25 27 2-21 18 6 28-22-15-23 15 7-28-21-18 27-2z"/>');
