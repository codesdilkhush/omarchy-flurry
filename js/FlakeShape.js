// Procedural snowflake shapes for the Canvas renderer.
//
// No bitmap assets and no per-particle QML objects. The desktop reference this
// build targets shows snowfall as soft, out-of-focus white points with an
// occasional larger crystal — not a sky full of six-armed sparkles. Tiny and
// medium flakes are therefore drawn as a faint halo plus a crisp bright core;
// the dendritic shape is reserved for the few big, slow chunks.
// Rotation is computed directly from cos/sin so the renderer never pays for
// ctx.save/restore per particle.

var TAU = 6.28318530718;
var THIRD = Math.PI / 3;

// Draw one flake into a 2D Canvas context. The caller owns clearRect; this
// function sets the composite state it needs and leaves globalAlpha at alpha.
function draw(ctx, x, y, radius, rotationDeg, alpha, type) {
  if (!ctx || radius <= 0 || !(alpha > 0)) return;
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;

  // A rare large crystal still reads as a snowflake when it is big enough to
  // resolve on screen. Everything else stays a soft point, like the video.
  if (type === 2 && radius >= 2.6) {
    var angle = rotationDeg * Math.PI / 180;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(0.7, radius * 0.14);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (var arm = 0; arm < 3; arm++) {
      var a = angle + arm * THIRD;
      var dx = Math.cos(a) * radius;
      var dy = Math.sin(a) * radius;
      ctx.moveTo(x - dx, y - dy);
      ctx.lineTo(x + dx, y + dy);
      for (var end = -1; end <= 1; end += 2) {
        var tipX = x + dx * end;
        var tipY = y + dy * end;
        for (var side = -1; side <= 1; side += 2) {
          var branch = a + side * THIRD;
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX + Math.cos(branch) * radius * 0.42,
            tipY + Math.sin(branch) * radius * 0.42);
        }
      }
    }
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.3;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.5, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.22, 0, TAU);
    ctx.fill();
    return;
  }

  // Soft focus halo, then the bright core. This keeps one-pixel flakes visible
  // against both dark wallpaper and light snow without looking like stars.
  ctx.fillStyle = "#ffffff";
  if (radius >= 0.7) {
    ctx.globalAlpha = alpha * 0.24;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.6, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { draw: draw, TAU: TAU };
}
