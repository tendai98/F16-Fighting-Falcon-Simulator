/* =====================================================================
   FlightHUD  —  flight symbology (pitch ladder, flight-path marker,
   speed/altitude tapes, heading, roll, throttle).

   Adapted from "simple-hud" by Ibrahim Bendebka (SB3NDER), MIT License,
   Copyright (c) 2020 Ibrahim Bendebka.  See LICENSE-simple-hud.txt.

   Changes for this project:
     - fixed virtual size taken from the canvas width/height attributes
       (no devicePixelRatio auto-resolution),
     - no internal requestAnimationFrame loop; a single render() call is
       driven by the sim's main loop,
     - data is fed each frame from the simulator's world state,
     - default colour matches the cockpit's neon green.
   The drawing routines (ladders, tapes, roll arc, throttle) are
   substantially unchanged from the original.
   ===================================================================== */
'use strict';

class FlightHUD {
  constructor(node) {
    this.canvas = node;
    this.ctx = this.canvas.getContext('2d');

    // virtual size == canvas pixel size (fixed; the sim controls resolution)
    this.size = { width: this.canvas.width, height: this.canvas.height };

    this.data = {
      pitch: 0, roll: 0, heading: 0,
      flight: { pitch: 0, heading: 0 },
      speed: 0, altitude: 0, throtle: 0,
    };

    this.settings = {
      _pixelPerDeg: null,
      _pixelPerRad: null,
      set pixelPerDeg(val){ this._pixelPerDeg = val; this._pixelPerRad = val*(180/Math.PI); },
      set pixelPerRad(val){ this._pixelPerRad = val; this._pixelPerDeg = val*(Math.PI/180); },
      uncagedMode: false,
      rollRadius: 'none',
      timezone: undefined,
      scale: 1,
    };
    this.settings.pixelPerDeg = 12;   // overridden by main to match the 3D view

    this.style = {
      lineWidth: 1.7,
      color: 'rgba(39, 255, 94, 0.95)',
      font: { style:'normal', variant:'normal', weight:'bold', family:'"Courier New", monospace', scale:1 },
      hasShadow: true,
      shadow: { lineWidth: 2.4, color: 'rgba(0,0,0,0.55)', offset: 1.6 },
      scale: 1,
      stepWidth: 8,
    };

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* one frame; called from the sim loop after data is updated */
  render() {
    const ctx = this.ctx;
    // keep virtual size in sync if the canvas was resized
    this.size.width = this.canvas.width;
    this.size.height = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.size.width, this.size.height);

    ctx.lineWidth = this.style.lineWidth;
    ctx.strokeStyle = this.style.color;
    ctx.fillStyle = this.style.color;

    // ---- dynamic (world-referenced) symbology, centred ----
    ctx.translate(this.size.width / 2, this.size.height / 2);

    // flight path marker
    this.drawWithShadow(() => {
      this.drawFlightPath(
        this.data.flight.heading * this.settings._pixelPerRad,
        -(this.data.flight.pitch * this.settings._pixelPerRad)
      );
    });

    if (this.settings.uncagedMode) {
      ctx.translate(
        this.settings._pixelPerRad *
          (this.data.flight.heading - this.data.flight.pitch * Math.tan(this.data.roll)),
        0
      );
    }

    // pitch ladders
    this.drawWithShadow(() => {
      ctx.rotate(this.data.roll);
      ctx.translate(0, this.data.pitch * this.settings._pixelPerRad);
      this.drawHorizonLadder(0, 0);
      const pitchDegStep = 10;
      for (let deg = pitchDegStep; deg <= 90; deg += pitchDegStep)
        this.drawPitchLadder(0, -(deg * this.settings._pixelPerDeg), deg);
      for (let deg = -pitchDegStep; deg >= -90; deg -= pitchDegStep)
        this.drawPitchLadder(0, -(deg * this.settings._pixelPerDeg), deg);
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // ---- fixed UI ----
    const border = 16;

    this.drawWithShadow(() => {
      this.drawVerticalScale(border, this.size.height / 2, this.data.speed, '9999', 41, false);
    });
    this.drawWithShadow(() => {
      this.drawVerticalScale(this.size.width - border, this.size.height / 2, this.data.altitude, '99999', 41, true);
    });
    // publish tape positions (as fractions of this canvas) so the tutorial can point at them accurately
    if (typeof world !== 'undefined'){
      const sz=this.size; world._hudAnchors = world._hudAnchors || {};
      world._hudAnchors.speed = { canvas:'hud', fx:(border+24)/sz.width, fy:0.5, fw:104/sz.width, fh:0.48 };
      world._hudAnchors.alt   = { canvas:'hud', fx:(sz.width-border-24)/sz.width, fy:0.5, fw:104/sz.width, fh:0.48 };
    }
    this.drawWithShadow(() => {
      this.drawHeading(this.size.width / 2, border, 61, false);
    });
    this.drawWithShadow(() => {
      this.drawRoll(this.size.width / 2, this.size.height - border, 51, 260, true);
    });
    this.drawWithShadow(() => {
      const yDif = 20 * this.style.font.scale + 4;
      this.drawThrotle(border, this.size.height / 2 - yDif);
    });
  }

  setFont(size, unit) {
    this.ctx.font = this.style.font.style + ' ' + this.style.font.variant + ' ' +
      this.style.font.weight + ' ' + size + unit + ' ' + this.style.font.family;
  }
  setFontScale(size, unit) { this.setFont(size * this.style.font.scale, unit); }

  drawWithShadow(drawCall) {
    if (this.style.hasShadow) {
      this.ctx.save();
      this.ctx.lineWidth = this.style.shadow.lineWidth;
      this.ctx.strokeStyle = this.style.shadow.color;
      this.ctx.fillStyle = this.style.shadow.color;
      this.ctx.translate(this.style.shadow.offset, this.style.shadow.offset);
      drawCall();
      this.ctx.restore();
    }
    drawCall();
  }

  drawFlightPath(x, y) {
    this.ctx.translate(x, y);
    const r = 12;
    this.ctx.beginPath();
    this.ctx.moveTo(r, 0); this.ctx.lineTo(0, r); this.ctx.lineTo(-r, 0); this.ctx.lineTo(0, -r); this.ctx.closePath();
    const line = 9;
    this.ctx.moveTo(r, 0); this.ctx.lineTo(r + line, 0);
    this.ctx.moveTo(0, -r); this.ctx.lineTo(0, -r - line);
    this.ctx.moveTo(-r, 0); this.ctx.lineTo(-r - line, 0);
    this.ctx.stroke();
    this.ctx.translate(-x, -y);
  }

  drawHorizonLadder(x, y) {
    this.ctx.translate(x, y);
    let length = 460, space = 80, q = 12;
    this.ctx.beginPath();
    this.ctx.moveTo(space / 2, 0); this.ctx.lineTo(length / 2 - q, 0); this.ctx.lineTo(length / 2, q);
    this.ctx.moveTo(-space / 2, 0); this.ctx.lineTo(-(length / 2 - q), 0); this.ctx.lineTo(-length / 2, q);
    this.ctx.stroke();
    this.ctx.setLineDash([6, 4]);
    length = 26;
    this.ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      this.ctx.translate(0, this.settings._pixelPerDeg);
      this.ctx.moveTo(space / 2, 0); this.ctx.lineTo(space / 2 + length, 0);
      this.ctx.moveTo(-space / 2, y); this.ctx.lineTo(-(space / 2 + length), 0);
    }
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.ctx.translate(-x, -y - 3 * this.settings._pixelPerDeg);
  }

  drawPitchLadder(x, y, value) {
    this.ctx.translate(x, y);
    const length = 200, space = 80, q = 12;
    this.ctx.beginPath();
    this.ctx.moveTo(space / 2, 0); this.ctx.lineTo(length / 2 - q, 0); this.ctx.lineTo(length / 2, value > 0 ? q : -q);
    this.ctx.moveTo(-space / 2, 0); this.ctx.lineTo(-(length / 2 - q), 0); this.ctx.lineTo(-length / 2, value > 0 ? q : -q);
    this.ctx.stroke();
    this.setFontScale(16, 'px');
    this.ctx.textAlign = 'right'; this.ctx.textBaseline = 'middle';
    const textBorder = 4, textWidth = this.ctx.measureText('-90').width;
    this.ctx.fillText(value, length / 2 + textBorder + textWidth, value > 0 ? q / 2 : -q / 2);
    this.ctx.fillText(value, -(length / 2 + textBorder), value > 0 ? q / 2 : -q / 2);
    this.ctx.translate(-x, -y);
  }

  drawVerticalScale(x, y, value, exampleValue, stepRange, right) {
    this.ctx.save();
    this.ctx.translate(x, y);
    let mf = right ? -1 : 1;
    let fontSize = 20 * this.style.font.scale;
    this.setFont(fontSize, 'px');
    const textSideBorder = 5, textTopBorder = 4;
    const textWidth = this.ctx.measureText(exampleValue).width;
    const height = fontSize + 2 * textTopBorder;
    const length = textSideBorder * 2 + textWidth + height / 2;
    this.ctx.textAlign = 'right'; this.ctx.textBaseline = 'middle';
    this.ctx.beginPath();
    this.ctx.moveTo(0, -height / 2);
    this.ctx.lineTo(mf * (textSideBorder * 2 + textWidth), -height / 2);
    this.ctx.lineTo(mf * length, 0);
    this.ctx.lineTo(mf * (textSideBorder * 2 + textWidth), height / 2);
    this.ctx.lineTo(0, height / 2);
    this.ctx.closePath(); this.ctx.stroke();
    this.ctx.fillText(Math.round(value), right ? -textSideBorder : textSideBorder + textWidth, 0);
    fontSize = 16 * this.style.font.scale; this.setFont(fontSize, 'px');
    const textBorder = 3, bd = 4, stepLength = [16, 11, 7];
    if (!right) this.ctx.textAlign = 'left';
    this.ctx.translate(mf * (length + bd), 0);
    this.ctx.rect(0, -((stepRange * this.style.stepWidth) / 2),
      mf * (stepLength[0] + 2 * textBorder + this.ctx.measureText(exampleValue + '9').width),
      stepRange * this.style.stepWidth);
    this.ctx.clip();
    const stepMargin = 5, stepZeroOffset = Math.ceil(stepRange / 2) + stepMargin;
    const stepValueOffset = Math.floor(value), stepOffset = value - stepValueOffset;
    this.ctx.translate(0, (stepZeroOffset + stepOffset) * this.style.stepWidth);
    this.ctx.beginPath();
    for (let i = -stepZeroOffset + stepValueOffset; i < stepZeroOffset + stepValueOffset; i++) {
      this.ctx.moveTo(0, 0);
      switch (Math.abs(i) % 10) {
        case 0: this.ctx.lineTo(mf * stepLength[0], 0); this.ctx.fillText(i, mf * (stepLength[0] + textBorder), 0); break;
        case 5: this.ctx.lineTo(mf * stepLength[1], 0); break;
        default: this.ctx.lineTo(mf * stepLength[2], 0); break;
      }
      this.ctx.translate(0, -this.style.stepWidth);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawHeading(x, y, stepRange, bottom) {
    this.ctx.save();
    this.ctx.translate(x, y);
    let mf = bottom ? -1 : 1;
    const value = this.data.heading * (180 / Math.PI);
    let fontSize = 20 * this.style.font.scale; this.setFont(fontSize, 'px');
    const textSideBorder = 5, textTopBorder = 4, textWidth = this.ctx.measureText('360').width;
    const length = textSideBorder * 2 + textWidth;
    const height = textTopBorder * 1.5 + fontSize + length / 4;
    this.ctx.textAlign = 'right'; this.ctx.textBaseline = 'middle';
    this.ctx.beginPath();
    this.ctx.moveTo(-length / 2, 0); this.ctx.lineTo(length / 2, 0);
    this.ctx.lineTo(length / 2, mf * (textTopBorder * 1.5 + fontSize));
    this.ctx.lineTo(0, mf * height);
    this.ctx.lineTo(-length / 2, mf * (textTopBorder * 1.5 + fontSize));
    this.ctx.closePath(); this.ctx.stroke();
    this.ctx.fillText(Math.round(value), textWidth / 2, (mf * (2 * textTopBorder + fontSize)) / 2);
    fontSize = 16 * this.style.font.scale; this.setFont(fontSize, 'px');
    const textBorder = 2, bd = 4, stepLength = [16, 11, 7];
    this.ctx.textAlign = 'center';
    this.ctx.translate(0, mf * (height + bd));
    this.ctx.rect((-stepRange * this.style.stepWidth) / 2, 0,
      this.style.stepWidth * stepRange, mf * (stepLength[0] + 2 * textBorder + fontSize));
    this.ctx.clip();
    const stepMargin = 5, stepZeroOffset = Math.ceil(stepRange / 2) + stepMargin;
    const stepValueOffset = Math.floor(value), stepOffset = value - stepValueOffset;
    this.ctx.translate(-(stepZeroOffset + stepOffset) * this.style.stepWidth, 0);
    this.ctx.beginPath();
    let text;
    for (let i = -stepZeroOffset + stepValueOffset; i < stepZeroOffset + stepValueOffset; i++) {
      const posI = Math.abs(i);
      this.ctx.moveTo(0, 0);
      switch (posI % 10) {
        case 0: this.ctx.lineTo(0, mf * stepLength[0]); break;
        case 5: this.ctx.lineTo(0, mf * stepLength[1]); break;
        default: this.ctx.lineTo(0, mf * stepLength[2]); break;
      }
      if (posI % 90 == 0 || posI % 45 == 0 || posI % 10 == 0) {
        switch (posI % 360) {
          case 0: text = 'N'; break; case 45: text = 'NE'; break; case 90: text = 'E'; break;
          case 135: text = 'SE'; break; case 180: text = 'S'; break; case 225: text = 'SW'; break;
          case 270: text = 'W'; break; case 315: text = 'NW'; break;
          default: text = i >= 0 ? i % 360 : 360 + (i % 360); break;
        }
        this.ctx.fillText(text, 0, mf * (stepLength[0] + textBorder + fontSize / 2));
      }
      this.ctx.translate(this.style.stepWidth, 0);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawRoll(x, y, stepRange, radius, bottom) {
    this.ctx.save();
    this.ctx.translate(x, y);
    let mf = bottom ? -1 : 1;
    const value = this.data.roll * (180 / Math.PI);
    let fontSize = 20 * this.style.font.scale; this.setFont(fontSize, 'px');
    const textSideBorder = 5, textTopBorder = 4, textWidth = this.ctx.measureText('180').width;
    const length = textSideBorder * 2 + textWidth;
    const height = textTopBorder * 1.5 + fontSize + length / 4;
    this.ctx.textAlign = 'right'; this.ctx.textBaseline = 'middle';
    this.ctx.beginPath();
    this.ctx.moveTo(-length / 2, 0); this.ctx.lineTo(length / 2, 0);
    this.ctx.lineTo(length / 2, mf * (textTopBorder * 1.5 + fontSize));
    this.ctx.lineTo(0, mf * height);
    this.ctx.lineTo(-length / 2, mf * (textTopBorder * 1.5 + fontSize));
    this.ctx.closePath(); this.ctx.stroke();
    this.ctx.fillText(Math.round(value), textWidth / 2, (mf * (2 * textTopBorder + fontSize)) / 2);
    fontSize = 16 * this.style.font.scale; this.setFont(fontSize, 'px');
    const textBorder = 2, bd = 4, stepLength = [16, 11, 7];
    this.ctx.textAlign = 'center';
    this.ctx.translate(0, mf * (height + bd));
    switch (this.settings.rollRadius) {
      case 'exact': radius = (this.style.stepWidth * 180) / Math.PI; break;
      case 'center': radius = this.size.height / 2 - (bottom ? this.size.height - y : y) - (height + bd); break;
      default: break;
    }
    if (radius < 0) { this.ctx.restore(); return; }
    this.ctx.translate(0, mf * radius);
    const angle = (stepRange * this.style.stepWidth) / radius;
    this.ctx.beginPath();
    this.ctx.moveTo(0, 0);
    this.ctx.arc(0, 0, radius, (bottom ? 0.5 : 1.5) * Math.PI - angle / 2, (bottom ? 0.5 : 1.5) * Math.PI + angle / 2);
    this.ctx.closePath(); this.ctx.clip();
    const stepMargin = 5, stepZeroOffset = Math.ceil(stepRange / 2) + stepMargin;
    const stepValueOffset = Math.floor(value), stepOffset = value - stepValueOffset;
    let text;
    this.ctx.beginPath();
    for (let i = -stepZeroOffset + stepValueOffset; i < stepZeroOffset + stepValueOffset; i++) {
      this.ctx.rotate((mf * -(stepValueOffset - i + stepOffset) * this.style.stepWidth) / radius);
      this.ctx.translate(0, mf * -radius);
      this.ctx.moveTo(0, 0);
      switch (Math.abs(i) % 10) {
        case 0:
          this.ctx.lineTo(0, mf * stepLength[0]);
          let val = i % 360;
          text = (val > 180 || val <= -180) ? val - Math.sign(i) * 360 : val;
          this.ctx.fillText(text, 0, mf * (stepLength[0] + textBorder + fontSize / 2));
          break;
        case 5: this.ctx.lineTo(0, mf * stepLength[1]); break;
        default: this.ctx.lineTo(0, mf * stepLength[2]); break;
      }
      this.ctx.translate(0, mf * radius);
      this.ctx.rotate((mf * (stepValueOffset - i + stepOffset) * this.style.stepWidth) / radius);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawThrotle(x, y) {
    this.setFontScale(16, 'px');
    this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
    const border = 8, indexLenght = 6, range = 1.5 * Math.PI, start = 0.5 * Math.PI;
    const radius = this.ctx.measureText('100%').width / 2 + border;
    const angle = start + range * this.data.throtle;
    const trX = x + radius + indexLenght, trY = y - radius - indexLenght;
    this.ctx.translate(trX, trY);
    this.ctx.fillText(Math.round(this.data.throtle * 100) + '%', 0, 0);
    this.ctx.beginPath();
    this.ctx.arc(0, 0, radius, start, angle);
    this.ctx.lineTo((radius + indexLenght) * Math.cos(angle), (radius + indexLenght) * Math.sin(angle));
    this.ctx.stroke();
    this.ctx.globalAlpha = 0.5;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, radius, angle, start + range);
    this.ctx.stroke();
    this.ctx.globalAlpha = 1;
    this.ctx.translate(-trX, -trY);
  }
}
