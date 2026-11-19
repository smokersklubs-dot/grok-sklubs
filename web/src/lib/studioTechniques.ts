import type { StudioTechnique } from "../../../server/src/studiotechniques";

export const techniqueLabels: Record<StudioTechnique, [string, string]> = {
  "retro-collage": ["Collage rétro", "Retro collage"],
  "drawn-stroke": ["Tracé dessiné", "Ink drawing"],
  "math-geometry": ["Géométrie mathématique", "Mathematical geometry"],
  "procedural-illustration": [
    "Illustration procédurale",
    "Procedural illustration",
  ],
  "motion-timing": ["Typographie cinétique", "Kinetic typography"],
  "canvas-animation": ["Flux de particules", "Particle flow"],
  "expressive-character": ["Personnage expressif", "Expressive character"],
  "moving-paint": ["Peinture en mouvement", "Moving paint"],
  "doodle-timelapse": ["Doodle accéléré", "Doodle timelapse"],
};

type Ctx = CanvasRenderingContext2D;
type Media = HTMLImageElement | HTMLVideoElement;
type Point = [number, number];
type Box = { x: number; y: number; w: number; h: number };
type Frame = {
  c: Ctx;
  w: number;
  h: number;
  p: number;
  seed: number;
  media?: Media;
};
const tau = 2 * Math.PI;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => {
  const x = clamp(n);
  return x * x * (3 - 2 * x);
};
const colors: Record<StudioTechnique, [string, string, string]> = {
  "retro-collage": ["#f0deb5", "#292535", "#bd4939"],
  "drawn-stroke": ["#f6efdb", "#283c38", "#cd7545"],
  "math-geometry": ["#11283a", "#ebf3e9", "#6de1cc"],
  "procedural-illustration": ["#f4d8b4", "#322b43", "#85425c"],
  "motion-timing": ["#201c3e", "#fff1dc", "#ff845d"],
  "canvas-animation": ["#0d2030", "#e9fbfa", "#65e8dd"],
  "expressive-character": ["#f8dfb6", "#3a293d", "#a44d50"],
  "moving-paint": ["#ead8bd", "#383b45", "#a74b48"],
  "doodle-timelapse": ["#f3edd7", "#293743", "#c46838"],
};
export const techniqueColors = (id: StudioTechnique) => colors[id];

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function noise(seed: number, index: number) {
  let x = Math.imul(seed ^ (index + 1), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
function ellipse(
  c: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  tilt = 0,
) {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, rx, ry, tilt, 0, tau);
  c.fill();
}
function polygon(c: Ctx, points: Point[], color: string) {
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(...points[0]);
  for (const point of points.slice(1)) c.lineTo(...point);
  c.closePath();
  c.fill();
}
// Return the current nib location. Measuring path lengths keeps stroke speed stable at corners.
function stroke(
  c: Ctx,
  path: Point[],
  amount: number,
  color: string,
  width: number,
): Point {
  const lengths = path
    .slice(1)
    .map(([x, y], i) => Math.hypot(x - path[i][0], y - path[i][1]));
  let remaining = clamp(amount) * lengths.reduce((a, b) => a + b, 0),
    tip = path[0];
  c.beginPath();
  c.moveTo(...tip);
  c.lineJoin = "round";
  c.lineCap = "round";
  for (let i = 0; i < lengths.length && remaining > 0; i++) {
    const f = Math.min(1, remaining / (lengths[i] || 1)),
      a = path[i],
      b = path[i + 1];
    tip = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    c.lineTo(...tip);
    remaining -= lengths[i];
  }
  c.strokeStyle = color;
  c.lineWidth = width;
  c.stroke();
  return tip;
}
function curve(fn: (t: number) => Point, steps = 64): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => fn(i / steps));
}
function contain(c: Ctx, image: Media, box: Box) {
  const iw =
    image instanceof HTMLVideoElement ? image.videoWidth : image.naturalWidth;
  const ih =
    image instanceof HTMLVideoElement ? image.videoHeight : image.naturalHeight;
  if (!(iw > 0 && ih > 0)) return;
  const scale = Math.min(box.w / iw, box.h / ih),
    w = iw * scale,
    h = ih * scale;
  c.drawImage(image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
}
function paper(f: Frame) {
  const { c, w, h, seed } = f;
  c.fillStyle = "rgba(90,64,40,.10)";
  for (let i = 0; i < 90; i++)
    c.fillRect(
      noise(seed, i) * w,
      noise(seed, i + 100) * h,
      1 + noise(seed, i + 200) * 2,
      1,
    );
}

// Each illustration uses a 600 × 400 drawing area. Its caller handles portrait layouts.
function illustration(c: Ctx, box: Box, draw: () => void) {
  const scale = Math.min(box.w / 600, box.h / 400);
  c.save();
  c.translate(box.x + box.w / 2, box.y + box.h / 2);
  c.scale(scale, scale);
  draw();
  c.restore();
}
function collage(f: Frame) {
  const { c, w, h, p, media, seed } = f;
  paper(f);
  const swell = Math.sin(p * Math.PI),
    entrance = ease(p * 3);
  polygon(
    c,
    [
      [0, h * 0.21],
      [w * 0.48, h * 0.07],
      [w * 0.53, h * 0.66],
      [0, h * 0.82],
    ],
    "#a5b8ac",
  );
  c.save();
  c.translate(w * 0.73, h * 0.33);
  c.rotate(-0.22 + 0.17 * p);
  for (let i = -5; i < 6; i++) {
    c.fillStyle = "#bd4939";
    c.fillRect(w * 0.031 * i, -h * 0.21, w * 0.014, h * 0.42);
  }
  c.restore();
  const bw = w * 0.69,
    bh = h * 0.67;
  c.save();
  c.translate(
    w * (0.51 - 0.09 * (1 - entrance)),
    h * (0.52 + 0.08 * (1 - entrance)),
  );
  c.rotate(-0.09 + 0.1 * entrance + 0.025 * swell);
  c.fillStyle = "#62533c";
  c.fillRect(-bw * 0.5 + 7, -bh * 0.5 + 9, bw, bh);
  const edge: Point[] = [
    [-bw * 0.5, -bh * 0.5],
    [bw * 0.5, -bh * 0.5],
    [bw * 0.5, bh * 0.5],
  ];
  for (let i = 0; i <= 22; i++)
    edge.push([bw * (0.5 - i / 22), bh * (0.48 + 0.035 * noise(seed, i))]);
  polygon(c, edge, "#fff4d9");
  c.fillStyle = "#274958";
  c.fillRect(-bw * 0.46, -bh * 0.44, bw * 0.92, bh * 0.82);
  if (media)
    contain(c, media, {
      x: -bw * 0.46,
      y: -bh * 0.44,
      w: bw * 0.92,
      h: bh * 0.82,
    });
  else {
    ellipse(
      c,
      bw * (0.1 + 0.08 * p),
      -bh * 0.13,
      bh * 0.15,
      bh * 0.15,
      "#f7c865",
    );
    polygon(
      c,
      [
        [-bw * 0.46, bh * 0.38],
        [-bw * 0.2, -bh * 0.08],
        [0, bh * 0.15],
        [bw * 0.19, -bh * 0.22],
        [bw * 0.46, bh * 0.38],
      ],
      "#8dbdb1",
    );
    polygon(
      c,
      [
        [-bw * 0.46, bh * 0.38],
        [-bw * 0.14, bh * 0.02],
        [bw * 0.03, bh * 0.18],
        [bw * 0.3, 0],
        [bw * 0.46, bh * 0.38],
      ],
      "#da764e",
    );
  }
  polygon(
    c,
    [
      [-bw * 0.32, -bh * 0.56],
      [-bw * 0.08, -bh * 0.59],
      [-bw * 0.07, -bh * 0.4],
      [-bw * 0.31, -bh * 0.38],
    ],
    "#dfbb6f",
  );
  c.restore();
}
function ink({ c, p }: Frame) {
  const strokes: Point[][] = [
    [
      [-226, -82],
      [-60, -37],
      [14, -118],
      [60, -31],
      [204, -92],
      [153, 0],
      [77, 39],
      [10, 93],
      [-47, 64],
      [-142, 24],
      [-226, -82],
    ],
    [
      [-226, -82],
      [-35, 14],
      [-60, -37],
    ],
    [
      [14, -118],
      [-4, 6],
      [60, -31],
    ],
    [
      [204, -92],
      [49, 11],
      [153, 0],
    ],
    [
      [-142, 24],
      [-35, 14],
      [10, 93],
      [49, 11],
      [77, 39],
    ],
    [
      [-47, 64],
      [-35, 14],
      [-4, 6],
      [49, 11],
    ],
    [
      [153, 0],
      [184, -11],
      [215, 4],
      [188, 8],
    ],
    [
      [-250, 35],
      [-215, 49],
      [-182, 52],
    ],
    [
      [-239, 63],
      [-210, 72],
    ],
  ];
  const progress = p * (strokes.length + 1);
  strokes.forEach((path, i) => {
    if (progress > i)
      stroke(
        c,
        path,
        progress - i,
        i < 7 ? "#293f3b" : "#c7754e",
        i === 0 ? 5 : 2.8,
      );
  });
  for (let i = 0; i < 11; i++) {
    const a = clamp(7 * p - i * 0.18 - 3.6);
    if (a)
      stroke(
        c,
        [
          [-123 + i * 6, 3 + i * 0.8],
          [-65 + i * 3, 27 + i * 1.4],
        ],
        a,
        "#67877a",
        1.7,
      );
  }
  if (p < 0.9) {
    const i = Math.min(strokes.length - 1, Math.floor(progress));
    const tip = stroke(c, strokes[i], progress - i, "#a96547", 1.2);
    ellipse(c, ...tip, 3, 3, "#bf6745");
  }
}
function geometry({ c, p, seed }: Frame) {
  for (let x = -260; x <= 260; x += 32)
    stroke(
      c,
      [
        [x, -160],
        [x, 160],
      ],
      1,
      "#2d4858",
      0.9,
    );
  for (let y = -160; y <= 160; y += 32)
    stroke(
      c,
      [
        [-260, y],
        [260, y],
      ],
      1,
      "#2d4858",
      0.9,
    );
  const k = 2 + Math.floor(noise(seed, 0) * 3),
    phase = 0.25 + p * tau * 0.55;
  const figure = (t: number): Point => [
    179 * Math.sin(3 * t * tau + phase),
    126 * Math.sin(k * t * tau),
  ];
  const trace = curve(figure, 220),
    tip = stroke(c, trace, 0.12 + 0.88 * p, "#8defcf", 3.4);
  stroke(
    c,
    [
      [tip[0], -158],
      [tip[0], tip[1]],
      [254, tip[1]],
    ],
    1,
    "#d19a64",
    1.3,
  );
  ellipse(c, ...tip, 7, 7, "#ffbd80");
  ellipse(c, 0, 0, 3, 3, "#c7e6de");
}
function landscape({ c, p, seed }: Frame) {
  ellipse(
    c,
    -120 + 47 * p,
    -67 - 19 * Math.sin(Math.PI * p),
    48,
    48,
    "#e79969",
  );
  const inks = ["#c4a5a4", "#aa8090", "#745a78", "#443f5e"];
  for (let layer = 0; layer < inks.length; layer++) {
    const y = -20 + layer * 36,
      slide = p * (10 + layer * 12),
      phase = noise(seed, layer) * 6;
    const ridge = (x: number) =>
      y +
      Math.sin((x + slide) * 0.012 + phase) * 29 +
      Math.sin((x + slide) * 0.023 + phase) * 12;
    const points = curve((t) => {
      const x = -278 + t * 556;
      return [x, ridge(x)];
    }, 90);
    polygon(c, [...points, [278, 172], [-278, 172]], inks[layer]);
    if (layer > 1)
      for (let i = 0; i < 22; i++) {
        const x = -269 + i * 25 - (slide % 25),
          height = 10 + noise(seed, layer * 50 + i) * 20,
          ground = ridge(x);
        polygon(
          c,
          [
            [x - 5, ground + 4],
            [x, ground - height],
            [x + 5, ground + 4],
          ],
          inks[layer],
        );
      }
  }
}
function currents({ c, p, seed }: Frame) {
  const inks = ["#61d5cc", "#a2cfe9", "#e9a87c", "#76a7c4"];
  for (let i = 0; i < 37; i++) {
    const v = i / 36,
      phase = noise(seed, i) * 0.32,
      speed = 0.25 + noise(seed, i + 40) * 0.35;
    const pos = (t: number): Point => [
      -285 + t * 570,
      (v - 0.5) * 254 +
        33 * Math.sin(t * 8 + v * 4 + 2 * p) +
        28 * Math.cos(t * 6 - v * 5 - 3 * p) +
        14 * Math.sin(t * 17 + phase),
    ];
    const head = (noise(seed, i + 90) + p * speed) % 1;
    stroke(
      c,
      curve((t) => pos(t), 60),
      1,
      "#254552",
      1,
    );
    const tail = Math.max(0, head - 0.1);
    stroke(
      c,
      curve((t) => pos(tail + t * (head - tail)), 12),
      1,
      inks[i % inks.length],
      1.4 + 2 * noise(seed, i + 140),
    );
    ellipse(c, ...pos(head), 2.8, 2.8, inks[i % inks.length]);
  }
}
function character({ c, p }: Frame) {
  const t = p * tau,
    bob = 10 * Math.sin(t),
    wave = Math.sin(t * 2.3);
  ellipse(c, 0, 145, 104 + 4 * Math.cos(t), 10, "#d4b58d");
  stroke(
    c,
    [
      [-40, 86],
      [-47, 129],
      [-73, 131],
    ],
    1,
    "#3d3441",
    13,
  );
  stroke(
    c,
    [
      [36, 86],
      [48, 125],
      [72, 126],
    ],
    1,
    "#3d3441",
    13,
  );
  c.save();
  c.translate(0, bob);
  c.rotate(0.045 * Math.sin(t));
  stroke(
    c,
    [
      [-65, 4],
      [-98, 18],
      [-117, 6],
    ],
    1,
    "#3d3441",
    11,
  );
  const hand: Point = [124 + 12 * wave, -58 + 19 * wave];
  stroke(c, [[67, 0], [100, -11], hand], 1, "#3d3441", 11);
  ellipse(c, ...hand, 12, 14, "#ef9973");
  c.fillStyle = "#627b74";
  c.beginPath();
  c.moveTo(-73, -13);
  c.quadraticCurveTo(0, -45, 71, -12);
  c.lineTo(81, 78);
  c.quadraticCurveTo(2, 126, -84, 84);
  c.closePath();
  c.fill();
  stroke(
    c,
    [
      [-58, 29],
      [-24, 45],
      [5, 30],
      [33, 44],
      [64, 28],
    ],
    1,
    "#e4c68f",
    6,
  );
  c.save();
  c.rotate(0.1 * Math.sin(t - 0.5));
  ellipse(c, 0, -48, 80, 71, "#e99670");
  ellipse(c, -53, -99, 27, 32, "#d87b60");
  ellipse(c, 52, -98, 26, 30, "#d87b60");
  const blink = 1 - 0.92 * Math.pow(Math.max(0, Math.cos((p - 0.4) * tau)), 75);
  for (const x of [-29, 29]) {
    ellipse(c, x, -55, 18, 21 * blink, "#fff4d9");
    ellipse(c, x + 4 * Math.sin(t), -54, 7, 9 * blink, "#302f3e");
    stroke(
      c,
      [
        [x - 13, -84],
        [x, -89 - 3 * wave],
        [x + 12, -84],
      ],
      1,
      "#6c4b48",
      4,
    );
  }
  ellipse(c, 0, -28, 8, 5, "#5a3c42");
  stroke(
    c,
    curve(
      (a) => [
        -15 + 30 * a,
        -12 + 9 * Math.sin(a * Math.PI) * (1 + 0.25 * wave),
      ],
      18,
    ),
    1,
    "#5b3940",
    4,
  );
  c.restore();
  c.restore();
}
function doodle({ c, p }: Frame) {
  const wheel = (x: number): Point[] =>
    curve((t) => [x + 58 * Math.cos(t * tau), 61 + 58 * Math.sin(t * tau)], 76);
  const paths: Point[][] = [
    wheel(-114),
    wheel(115),
    [
      [-114, 61],
      [-60, -40],
      [0, 59],
      [-114, 61],
    ],
    [
      [0, 59],
      [84, -40],
      [-60, -40],
    ],
    [
      [115, 61],
      [78, -59],
      [68, -84],
      [95, -86],
    ],
    [
      [-60, -40],
      [-76, -78],
    ],
    [
      [-101, -79],
      [-58, -79],
    ],
    [
      [0, 59],
      [24, 77],
      [39, 77],
    ],
    [
      [-210, -29],
      [-163, -29],
    ],
    [
      [-225, -9],
      [-177, -9],
    ],
  ];
  for (const x of [-114, 115])
    for (let n = 0; n < 8; n++) {
      const angle = (n * tau) / 8;
      paths.push([
        [x, 61],
        [x + 54 * Math.cos(angle), 61 + 54 * Math.sin(angle)],
      ]);
    }
  const at = ease(p) * paths.length;
  let nib: Point = paths[0][0];
  for (let i = 0; i < paths.length && i <= at; i++)
    nib = stroke(
      c,
      paths[i],
      at - i,
      i === 2 || i === 3 ? "#b65f38" : "#324652",
      i < 8 ? 4 : 2.1,
    );
  c.save();
  c.translate(...nib);
  c.rotate(0.4);
  polygon(
    c,
    [
      [0, 0],
      [1, -14],
      [10, -12],
    ],
    "#333b43",
  );
  polygon(
    c,
    [
      [1, -14],
      [10, -12],
      [20, -69],
      [12, -71],
    ],
    "#e3a542",
  );
  c.restore();
}
function paint(f: Frame) {
  const { c, w, h, p, seed, media } = f;
  const inks = [
    "#8dade0",
    "#588d91",
    "#efb276",
    "#b66765",
    "#e6c792",
    "#607878",
    "#9ca97d",
  ];
  for (let i = 0; i < 89; i++) {
    const band = noise(seed, i),
      x = noise(seed, i + 100) * w,
      y = band * h;
    const span = w * (0.07 + 0.16 * noise(seed, i + 187)),
      angle = -0.25 + 0.28 * Math.sin(band * 7 + p * 2);
    const shift = w * 0.033 * Math.sin(p * tau * 0.7 + band * 9);
    c.save();
    c.translate(x + shift, y);
    c.rotate(angle);
    c.globalAlpha = 0.57 + 0.3 * noise(seed, i + 280);
    const hue =
        inks[
          (Math.floor(band * 6) + Math.floor(noise(seed, i + 373) * 3)) %
            inks.length
        ],
      depth = h * (0.018 + 0.04 * noise(seed, i + 431));
    for (let j = 0; j < 5; j++) {
      const bristle = depth * (j / 4 - 0.5);
      stroke(
        c,
        curve(
          (t) => [
            (t - 0.5) * span,
            bristle + depth * 0.25 * Math.sin(t * 3 + p + band * 5),
          ],
          14,
        ),
        1,
        hue,
        depth * (0.3 - 0.028 * j),
      );
    }
    c.restore();
  }
  if (media) {
    const box = { x: w * 0.1, y: h * 0.08, w: w * 0.8, h: h * 0.84 },
      reveal = 0.12 + 0.88 * ease(p * 1.5);
    c.save();
    c.beginPath();
    for (let i = 0; i < 46; i++) {
      const offset = 0.09 * Math.sin(i * 0.68) - 0.04 * noise(seed, i + 233);
      c.rect(
        box.x,
        box.y + (i * box.h) / 46,
        box.w * clamp(reveal + offset * (1 - reveal)),
        box.h / 46 + 1,
      );
    }
    c.clip();
    contain(c, media, box);
    c.restore();
  }
}

const illustrators = {
  "drawn-stroke": ink,
  "math-geometry": geometry,
  "procedural-illustration": landscape,
  "canvas-animation": currents,
  "expressive-character": character,
  "doodle-timelapse": doodle,
};

export function drawTechnique(
  c: Ctx,
  id: StudioTechnique,
  w: number,
  h: number,
  p: number,
  seedText: string,
  media: Media | undefined,
  captioned: boolean,
) {
  const [background, , accent] = colors[id];
  c.save();
  c.fillStyle = background;
  c.fillRect(0, 0, w, h);
  const artH = captioned && id !== "motion-timing" ? h * 0.75 : h;
  c.beginPath();
  c.rect(0, 0, w, artH);
  c.clip();
  const f: Frame = { c, w, h: artH, p, seed: hash(seedText), media };
  if (id === "retro-collage") collage(f);
  else if (id === "moving-paint") paint(f);
  else if (id === "motion-timing") {
    if (media) {
      contain(c, media, { x: 0, y: 0, w, h });
      c.fillStyle = "rgba(23,19,47,.72)";
      c.fillRect(0, 0, w, h);
    }
    c.save();
    c.translate(w * 0.5, h * 0.5);
    c.rotate(-0.27);
    for (let i = 0; i < 4; i++) {
      const t = (p + i * 0.26) % 1;
      c.fillStyle = i === 1 ? accent : "#68549a";
      c.fillRect(
        (t * 1.8 - 0.9) * w,
        (i % 2 ? 0.3 : -0.34) * h,
        w * 0.23,
        Math.max(2, h * 0.014),
      );
    }
    c.restore();
  } else {
    if (id === "drawn-stroke" || id === "doodle-timelapse") paper(f);
    let box: Box = { x: 0, y: 0, w, h: artH };
    if (media) {
      const wide = w >= artH,
        img = wide
          ? { x: w * 0.04, y: artH * 0.08, w: w * 0.54, h: artH * 0.84 }
          : { x: w * 0.06, y: artH * 0.035, w: w * 0.88, h: artH * 0.52 };
      box = wide
        ? { x: w * 0.58, y: 0, w: w * 0.41, h: artH }
        : { x: w * 0.04, y: artH * 0.57, w: w * 0.92, h: artH * 0.41 };
      c.save();
      c.beginPath();
      c.rect(img.x, img.y, img.w * ease(0.55 + 2 * p), img.h);
      c.clip();
      contain(c, media, img);
      c.restore();
    }
    illustration(c, box, () => illustrators[id](f));
  }
  c.restore();
}

export function kineticTitle(
  c: Ctx,
  text: string,
  w: number,
  h: number,
  p: number,
) {
  const groups: string[][] = [];
  let group: string[] = [];
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (
      group.length &&
      (group.length >= 5 || [...group, word].join(" ").length > 28)
    ) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length) groups.push(group);
  if (!groups.length) return;
  const scaled = p * groups.length,
    page = Math.min(groups.length - 1, Math.floor(scaled));
  const words = groups[page],
    local = scaled - page;
  const lines =
    words.length > 2
      ? [
          words.slice(0, Math.ceil(words.length / 2)).join(" "),
          words.slice(Math.ceil(words.length / 2)).join(" "),
        ]
      : [words.join(" ")];
  c.save();
  c.textAlign = "center";
  c.textBaseline = "middle";
  const size = Math.min(w * 0.135, h * 0.225);
  c.font = "900 " + size + "px system-ui,sans-serif";
  const fit = Math.min(
    1,
    ...lines.map((s) => (w * 0.85) / Math.max(1, c.measureText(s).width)),
  );
  const font = size * fit;
  c.font = "900 " + font + "px system-ui,sans-serif";
  lines.forEach((line, i) => {
    const t = clamp((local - i * 0.09) * 4.8),
      spring = 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 2.3);
    const y = h * (0.46 + (i - (lines.length - 1) / 2) * 0.2);
    c.save();
    c.translate(w * 0.5 + (1 - spring) * w * 0.2, y);
    c.scale(0.91 + 0.09 * spring, 0.91 + 0.09 * spring);
    c.globalAlpha = 0.24 + 0.76 * ease(t);
    c.fillStyle = i ? "#ffab7b" : "#fff1dc";
    c.fillText(line, 0, 0, w * 0.9);
    c.restore();
  });
  c.restore();
}
