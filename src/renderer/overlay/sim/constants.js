// Tuning values. Distances are in px at character scale 1 and get multiplied by
// the character's scale, so a bigger character moves the same in "body lengths".

export const BODY = {
  w: 50, // body width
  h: 46, // body height
  leg: 12, // hip to sole
  antenna: 17,
};

// Collision box around the feet point (x, y): [x - hw, x + hw] x [y - h, y]
export const HIT = { hw: 20, h: 60 };

// Distance from the feet to the body center when standing upright.
export const CENTER_Y = BODY.leg + BODY.h / 2;

export const PHYS = {
  gravity: 2600,
  walk: 165,
  run: 430,
  groundAccel: 2600,
  groundDecel: 3000,
  turnAccel: 5200,
  airAccel: 1500,
  airDrag: 0.35, // per second, only when no input
  jumpVel: 870,
  doubleJumpVel: 760,
  jumpCut: 0.45,
  coyote: 0.1,
  jumpBuffer: 0.13,
  maxFall: 2300,
  wallSlideMax: 150,
  wallJumpVx: 470,
  wallJumpVy: 820,
  wallJumpLock: 0.17,
  wallBounce: 0.5,
  floorBounce: 0.34,
  ceilingBounce: 0.3,
  bounceMin: 620, // impact speed above which a thrown character bounces
  dizzyImpact: 2100,
  throwMax: 4200,
  ropeMax: 720,
  ropeMin: 34,
  ropeShoot: 3400,
  ropeReel: 340,
  ropePump: 950,
  ropeDrag: 0.12,
  heldDamping: 2.4,
  climbUp: 150,
  climbDown: 240,
  // With wings: every jump press in the air is a flap; holding jump glides.
  flapVel: 640,
  flapCD: 0.13,
  glideMax: 190,
};

export const SUBSTEP = 1 / 240;
export const MAX_FRAME_DT = 1 / 20;
