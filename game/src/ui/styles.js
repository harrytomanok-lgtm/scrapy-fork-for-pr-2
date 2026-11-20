/**
 * The "kite paper and ring" identity (ART_UX 7.1) as CSS on the theme tokens of core/theme.js: cut-paper slabs
 * with a 12 px diagonal corner at the top start over a darker slab offset 4 px, paper ribbons, ring selection,
 * Secular One numbers with tabular figures, 180 / 120 ms motion (fades only with Reduced Motion), logical
 * properties everywhere except the physically centred HUD pieces (compass, target frame, toasts, banners).
 * HUD modes (logic/layout.js) are classes on `.ui-hud`: ui-m-portrait, ui-m-landscape, ui-m-short, ui-m-desktop.
 * @module ui/styles
 */

const CUT = 'polygon(12px 0,100% 0,100% 100%,0 100%,0 12px)';
const CUT_RTL = 'polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)';
const CUT_S = 'polygon(8px 0,100% 0,100% 100%,0 100%,0 8px)';
const CUT_S_RTL = 'polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,0 100%)';
const OUTLINE = '-1px -1px 0 var(--ink),1px -1px 0 var(--ink),-1px 1px 0 var(--ink),1px 1px 0 var(--ink),0 0 6px rgba(27,22,38,.9)';

export const UI_CSS = `
#app{--ui-track:#2A2233;--ui-chip:#FFD0A0;--ui-crit:#FFD45A;--ui-hurt:#FF6A6A;--ui-hostile:#B06CFF;--ui-red:#FF3B3B;
  --ui-slab:rgba(8,6,14,.55);--ui-solid:#241D33;--ui-dim:rgba(27,22,38,.6);--ui-ease:cubic-bezier(.2,.8,.2,1);--ui-cx:50%;
  --map-ring:#127C70;--map-siphon:#6A2FB0;--map-quest:#B5651D;--map-camp:#7A2E3A;--map-chest:#6B4A1E;--map-sleep:#6E6878;--map-view:#3E6FA8;--map-shard:#2C9C8C}
.ui-hud,.ui-scr{font-family:var(--font-body);color:var(--paper);line-height:1.35}
.ui-num,.ui-hud bdi{font-family:var(--font-display);font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate}
.ui-ico{inline-size:24px;block-size:24px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ui-test *,.ui-test *::before,.ui-test *::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}

/* ------------------------------------------------------------------ HUD */
.ui-hud{position:absolute;inset:0;pointer-events:none;transition:opacity 400ms linear}
.ui-hud[hidden]{display:none}
.ui-hud{--med:48px;--hpw:220px;--hph:12px;--oraw:200px;--orah:8px;--resfs:18px;--endb:48px;--tw:240px;--tracker:220px}
.ui-hud.ui-m-desktop{--med:64px;--hpw:320px;--hph:14px;--oraw:300px;--orah:10px;--resfs:22px;--tracker:280px}
.ui-hud.ui-m-portrait{--med:40px;--hpw:min(180px,calc(100vw - 222px));--hph:10px;--oraw:min(160px,calc(100vw - 242px));--orah:8px;--resfs:15px;--endb:44px;--tw:200px}
.ui-hud.ui-m-short{--med:28px;--hpw:116px;--hph:10px;--oraw:104px;--orah:6px;--resfs:15px;--endb:30px;--tracker:156px}
.ui-hud.ui-m-landscape,.ui-hud.ui-m-short{--ui-cx:calc(50% - 52px);--tw:min(240px,calc(100% - 465px))}
.ui-fadeable{transition:opacity 400ms linear}
.ui-hud.ui-faded .ui-fadeable{opacity:.35}

.ui-block{position:absolute;inset-block-start:var(--safe-top);inset-inline-start:var(--safe-left);display:grid;
  grid-template-columns:var(--med) auto;grid-template-areas:"med bars" "med res";column-gap:8px;row-gap:2px;align-items:start}
.ui-m-short .ui-block{grid-template-columns:var(--med) auto auto;grid-template-areas:"med bars res";column-gap:6px;align-items:center}
.ui-med{grid-area:med;position:relative;inline-size:var(--med);block-size:var(--med);border-radius:50%;pointer-events:auto;cursor:pointer;
  background:radial-gradient(circle at 50% 38%,#3A2F4F 0,var(--ink) 70%);display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 0 2px var(--ink),inset 0 0 0 1px var(--line)}
.ui-med-ring{position:absolute;inset:0;inline-size:100%;block-size:100%;transform:rotate(-90deg)}
.ui-med-ring circle{fill:none;stroke-width:3.2}
.ui-ring-track{stroke:rgba(243,235,221,.18)}
.ui-ring-fill{stroke:var(--ui-crit);stroke-linecap:round;transition:stroke-dashoffset 300ms var(--ui-ease)}
.ui-med.ui-full .ui-ring-fill{stroke:var(--paper);filter:drop-shadow(0 0 3px var(--ui-crit))}
.ui-med-lv{position:relative;font-family:var(--font-display);font-size:calc(var(--med) * .42);line-height:1;color:var(--paper)}
.ui-m-short .ui-med-lv{font-size:13px}
.ui-badge{position:absolute;inset-block-start:0;inset-inline-end:0;inline-size:10px;block-size:10px;border-radius:50%;background:var(--warn);
  box-shadow:0 0 0 2px var(--ink);transform:scale(0);transition:transform 180ms var(--ui-ease)}
.ui-badge.ui-on{transform:scale(1);animation:ui-pulse 1.6s ease-in-out infinite}
.ui-bars{grid-area:bars;display:flex;flex-direction:column;gap:4px;padding-block-start:4px}
.ui-m-short .ui-bars{padding:0;gap:3px}
.ui-bar{position:relative;inline-size:var(--hpw);block-size:var(--hph);background:var(--ui-track);overflow:hidden;
  box-shadow:0 0 0 2px var(--ink);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%)}
.ui-bar.ui-ora{inline-size:var(--oraw);block-size:var(--orah);clip-path:none;border-radius:var(--orah)}
.ui-fill{position:absolute;inset:0;transform-origin:left center;transform:scaleX(1);will-change:transform}
#app[dir=rtl] .ui-fill{transform-origin:right center}
.ui-hp .ui-fill{background:linear-gradient(to bottom,#F27A82 0,var(--hp) 55%,#B8394A 100%)}
.ui-hp .ui-chipfill{background:var(--ui-chip)}
.ui-hp .ui-healfill{background:linear-gradient(to bottom,#F4FFF4,var(--ok));opacity:.9}
.ui-hp.ui-hit{animation:ui-barhit 260ms ease-out}
.ui-ora .ui-spentfill{background:#F4FFFD;opacity:0}
.ui-ora .ui-spentfill.ui-on{animation:ui-spent 520ms ease-out forwards}
.ui-med.ui-lowhp{box-shadow:0 0 0 2px var(--ink),inset 0 0 0 1px var(--line),0 0 10px 2px rgba(232,80,91,.7);animation:ui-heart 900ms ease-in-out infinite}
.ui-med.ui-full{animation:ui-surgefull 1.4s ease-in-out infinite}
.ui-hp.ui-low .ui-fill{animation:ui-lowhp 900ms ease-in-out infinite}
.ui-ora .ui-fill{background:linear-gradient(to bottom,#C8FFF6 0,var(--accent) 60%,#3FB7A8 100%)}
.ui-ticks{position:absolute;inset:0;background-image:repeating-linear-gradient(to right,transparent 0,transparent calc(var(--tick,25%) - 2px),var(--ink) calc(var(--tick,25%) - 2px),var(--ink) var(--tick,25%))}
#app[dir=rtl] .ui-ticks{background-image:repeating-linear-gradient(to left,transparent 0,transparent calc(var(--tick,25%) - 2px),var(--ink) calc(var(--tick,25%) - 2px),var(--ink) var(--tick,25%))}
.ui-ora.ui-burn .ui-fill{background:repeating-linear-gradient(135deg,#8A8494 0,#8A8494 3px,#5A5464 3px,#5A5464 6px)}
.ui-res{grid-area:res;justify-self:start;display:flex;align-items:baseline;gap:6px;white-space:nowrap;text-shadow:${OUTLINE}}
.ui-res-label{font-family:var(--font-display);font-size:calc(var(--resfs) * .62);letter-spacing:.08em;color:var(--paper-dim)}
.ui-res-num{font-size:var(--resfs);line-height:1.1;color:var(--paper)}
.ui-res.ui-flash .ui-res-num{animation:ui-resflash 700ms ease-out}
.ui-m-short .ui-res{inline-size:84px;overflow:hidden}
.ui-xp{position:absolute;inset-inline:0;inset-block-end:env(safe-area-inset-bottom,0px);block-size:2px;background:rgba(27,22,38,.55)}
.ui-xp .ui-fill{background:linear-gradient(to right,var(--paper-dim),var(--paper))}

.ui-endbar{position:absolute;inset-block-start:var(--safe-top);inset-inline-end:var(--safe-right);display:flex;gap:8px;align-items:center}
.ui-hbtn{position:relative;inline-size:var(--endb);block-size:var(--endb);padding:0;border:0;border-radius:50%;background:var(--panel);color:var(--paper);
  display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;box-shadow:0 0 0 2px var(--ink),inset 0 0 0 1.5px rgba(243,235,221,.5);
  transition:transform 80ms ease-out}
.ui-hbtn:active{transform:scale(.94)}
.ui-m-short .ui-hbtn{inline-size:40px;border-radius:15px}
.ui-m-short .ui-hbtn .ui-ico{inline-size:18px;block-size:18px}
.ui-warn{inline-size:24px;block-size:24px;border-radius:50%;background:var(--warn);color:var(--ink);display:flex;align-items:center;justify-content:center;
  pointer-events:auto;cursor:pointer;box-shadow:0 0 0 2px var(--ink)}
.ui-warn .ui-ico{inline-size:16px;block-size:16px}
.ui-warn[hidden]{display:none}

.ui-compass{position:absolute;inset-block-start:var(--safe-top);left:50%;transform:translateX(-50%);
  inline-size:clamp(120px,calc(100% - 2 * (var(--safe-left) + var(--med) + 8px + var(--hpw) + 24px)),280px);block-size:22px;
  overflow:hidden;background:linear-gradient(to right,transparent,rgba(27,22,38,.72) 18%,rgba(27,22,38,.72) 82%,transparent);direction:ltr}
.ui-m-short .ui-compass{inline-size:clamp(108px,calc(100% - 2 * (var(--safe-left) + 254px)),280px)}
.ui-m-desktop .ui-compass{inline-size:420px;block-size:24px}
.ui-m-portrait .ui-compass{inset-block-start:calc(var(--safe-top) + 64px);inline-size:calc(100% - 32px)}
.ui-cmk{position:absolute;inset-block-start:0;left:0;block-size:100%;inline-size:0;will-change:transform}
.ui-cmk::before{content:"";position:absolute;inset-block-end:2px;left:-1px;inline-size:2px;block-size:5px;background:rgba(243,235,221,.6)}
.ui-cmk.ui-card::before{block-size:0}
.ui-cmk b{position:absolute;inset-block-start:3px;left:-8px;inline-size:16px;text-align:center;font:12px/1 var(--font-display);color:var(--paper)}
.ui-cmk.ui-north b{color:var(--ui-crit)}
.ui-pip{position:absolute;inset-block-start:7px;left:-4px;inline-size:8px;block-size:8px;border-radius:50%;background:var(--paper-dim);box-shadow:0 0 0 1.5px var(--ink);will-change:transform}
.ui-pip.ui-pip-spire{background:var(--accent);inline-size:10px;block-size:10px;left:-5px;inset-block-start:6px;border-radius:2px;transform-origin:50% 50%}
.ui-pip.ui-pip-ring{background:transparent;box-shadow:0 0 0 2px var(--accent),0 0 0 3.5px var(--ink)}
.ui-pip.ui-pip-siphon{background:var(--ui-hostile)}
.ui-quest{position:absolute;inset-block-start:4px;left:-7px;inline-size:14px;block-size:14px;color:var(--ui-crit);filter:drop-shadow(0 0 1px var(--ink)) drop-shadow(0 0 1px var(--ink));will-change:transform}
.ui-quest .ui-ico{inline-size:14px;block-size:14px}
.ui-quest.ui-edge{opacity:.6}
.ui-ccenter{position:absolute;left:50%;inset-block-start:0;inline-size:2px;margin-left:-1px;block-size:6px;background:var(--paper)}

.ui-target{position:absolute;inset-block-start:calc(var(--safe-top) + 28px);left:var(--ui-cx);transform:translateX(-50%);inline-size:var(--tw);
  display:flex;flex-direction:column;gap:3px;text-shadow:${OUTLINE};pointer-events:auto;touch-action:none}
.ui-m-short .ui-target{inset-block-start:calc(var(--safe-top) + 32px)}
.ui-m-portrait .ui-target{inset-block-start:calc(var(--safe-top) + 92px)}
.ui-target[hidden]{display:none}
.ui-tname{display:flex;gap:6px;align-items:baseline;justify-content:center;font-size:var(--fs-small);line-height:1.15;white-space:nowrap;overflow:hidden}
.ui-tname span{overflow:hidden;text-overflow:ellipsis}
.ui-tlv{color:var(--paper-dim);font-size:11px}
.ui-target .ui-bar{inline-size:100%;block-size:8px}
.ui-target .ui-fill{background:linear-gradient(to bottom,#C99BFF,var(--ui-hostile))}
.ui-target .ui-chipfill{background:var(--paper)}
.ui-tpoise{block-size:4px!important;clip-path:none!important}
.ui-tpoise .ui-fill{background:var(--paper-dim)!important}
/* A camp leader: its name and rank crest in the rare colour, a rare rim on its bar. */
.ui-trank{display:inline-flex;align-self:center;inline-size:12px;block-size:12px;color:var(--rarity-r);filter:drop-shadow(0 0 2px var(--ink))}
.ui-trank[hidden]{display:none}
.ui-trank .ui-ico{inline-size:12px;block-size:12px;fill:currentColor}
.ui-target.ui-elite .ui-tname{align-items:center;overflow:visible}
.ui-target.ui-elite .ui-tname span{padding:1px 8px;background:var(--rarity-r);color:var(--ink);text-shadow:none;font-family:var(--font-display);
  clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%)}
.ui-target.ui-elite .ui-trank{inline-size:14px;block-size:14px}
.ui-target.ui-elite .ui-trank .ui-ico{inline-size:14px;block-size:14px}
.ui-target.ui-elite .ui-bar:not(.ui-tpoise){border-block-start:2px solid var(--rarity-r)}
.ui-target.ui-boss{inline-size:min(60%,var(--tw-boss,100%))}
.ui-m-landscape .ui-target.ui-boss,.ui-m-short .ui-target.ui-boss{inline-size:min(60%,calc(100% - 465px))}
.ui-m-portrait .ui-target.ui-boss{inline-size:90%}
.ui-m-desktop .ui-target.ui-boss{inline-size:50%}
.ui-target.ui-boss .ui-tname{font-family:var(--font-display);font-size:var(--fs-body)}
.ui-target.ui-boss .ui-bar:not(.ui-tpoise){block-size:10px}
.ui-target.ui-boss .ui-fill{background:linear-gradient(to bottom,#F27A82,var(--danger))}
.ui-notch{position:absolute;inset-block:0;inline-size:2px;background:var(--ink)}

.ui-tracker{position:absolute;inset-block-start:calc(var(--safe-top) + var(--endb) + 8px);inset-inline-end:var(--safe-right);inline-size:var(--tracker);
  padding:6px 10px 7px;background:linear-gradient(to left,rgba(27,22,38,.78),rgba(27,22,38,.5));border-inline-end:3px solid var(--ui-crit);
  font-size:13px;line-height:1.3;text-shadow:0 1px 2px var(--ink)}
#app[dir=rtl] .ui-tracker{background:linear-gradient(to right,rgba(27,22,38,.78),rgba(27,22,38,.5))}
.ui-tracker[hidden]{display:none}
.ui-tr-title{display:flex;gap:6px;align-items:center;font-family:var(--font-display);color:var(--ui-crit);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ui-tr-title .ui-ico{inline-size:12px;block-size:12px}
.ui-tr-obj{color:var(--paper);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ui-hud.ui-touch:not(.ui-m-portrait) .ui-tracker{inset-inline-end:auto;left:var(--safe-left);inset-block-start:calc(100% - env(safe-area-inset-bottom,0px) - 234px)}
.ui-m-short .ui-tracker{padding:4px 8px 5px}
.ui-m-portrait .ui-tracker{inset-block-start:calc(var(--safe-top) + 92px);inset-inline:var(--safe-left) var(--safe-right);inline-size:auto;pointer-events:auto;cursor:pointer}
.ui-m-portrait .ui-tracker:not(.ui-open) .ui-tr-title{display:none}

.ui-toasts{position:absolute;inset-block-start:calc(var(--safe-top) + 68px);left:var(--ui-cx);transform:translateX(-50%);inline-size:var(--tw);
  display:flex;flex-direction:column;gap:6px;align-items:center}
.ui-lane .ui-toasts{position:relative;inset:auto;left:auto;transform:none;flex-direction:column-reverse;inline-size:auto;max-inline-size:100%}
.ui-m-desktop .ui-toasts{inset-block-start:calc(var(--safe-top) + 84px)}
.ui-toasts{transition:opacity 200ms ease-out}
.ui-hud.ui-bnr:not(.ui-m-portrait) .ui-toasts{opacity:0}
.ui-toast{position:relative;max-inline-size:100%;display:flex;gap:8px;align-items:center;padding:6px 12px;background:var(--panel);
  box-shadow:0 0 0 2px var(--ink);font-size:var(--fs-small);line-height:1.3;clip-path:${CUT_S};opacity:0;transform:translateY(-6px);
  transition:opacity 180ms ease-out,transform 180ms var(--ui-ease)}
#app[dir=rtl] .ui-toast{clip-path:${CUT_S_RTL}}
.ui-toast::before{content:"";flex:none;inline-size:6px;block-size:6px;border-radius:50%;background:var(--accent)}
.ui-toast.ui-good::before{background:var(--ok)}
.ui-toast.ui-warnk::before{background:var(--warn)}
.ui-toast[hidden]{display:none}
.ui-toast.ui-on{opacity:1;transform:none}
.ui-toast span{overflow:hidden;text-overflow:ellipsis}
.ui-m-short .ui-toast span{white-space:nowrap}

.ui-bwrap{position:absolute;top:24%;left:50%;inline-size:0;block-size:0;display:flex;align-items:center;justify-content:center;transition:transform 220ms var(--ui-ease)}
.ui-m-portrait .ui-bwrap{top:21%}
.ui-tgt .ui-bwrap{top:calc(var(--safe-top) + 150px)}
.ui-m-portrait.ui-tgt .ui-bwrap{top:calc(var(--safe-top) + 200px)}
.ui-banner{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;flex:none;max-inline-size:calc(100vw - 32px);
  opacity:0;transform:scale(.86);transition:opacity 260ms ease-in,transform 260ms ease-in}
.ui-banner.ui-on{opacity:1;transform:none;transition:opacity 200ms ease-out,transform 360ms cubic-bezier(.2,1.5,.4,1)}
.ui-banner-kicker{font-size:var(--fs-small);letter-spacing:.14em;color:var(--paper);text-shadow:${OUTLINE}}
.ui-banner-main{position:relative;padding:6px 28px 8px;background:var(--paper);color:var(--ink);font-family:var(--font-display);font-size:var(--fs-banner);line-height:1.1;
  white-space:nowrap;max-inline-size:calc(100vw - 32px);overflow:hidden;text-overflow:ellipsis;
  clip-path:polygon(14px 0,calc(100% - 14px) 0,100% 50%,calc(100% - 14px) 100%,14px 100%,0 50%);box-shadow:inset 0 -4px 0 rgba(27,22,38,.15)}
.ui-banner.ui-on .ui-banner-main::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.75) 50%,transparent 70%);
  transform:translateX(-110%);animation:ui-sheen 900ms 180ms ease-out forwards}
.ui-banner-sub{margin-block-start:4px;padding:3px 12px;background:var(--panel);box-shadow:0 0 0 2px var(--ink);font-family:var(--font-display);font-size:var(--fs-small);
  color:var(--paper);text-align:center;line-height:1.35;max-inline-size:min(360px,calc(100vw - 32px));opacity:0;transform:translateY(-6px);transition:opacity 200ms,transform 200ms}
.ui-banner-sub[hidden]{display:none}
.ui-banner.ui-on .ui-banner-sub{opacity:1;transform:none;transition-delay:220ms}
.ui-m-short .ui-banner-main,.ui-m-portrait .ui-banner-main{font-size:var(--fs-title)}
.ui-m-portrait .ui-banner-main,.ui-m-portrait .ui-banner.ui-k-region .ui-banner-main{font-size:min(var(--fs-title),8vw)}
.ui-banner.ui-k-level .ui-banner-main{background:linear-gradient(to bottom,#FFF6D8,var(--ui-crit))}
.ui-banner.ui-k-level .ui-banner-sub{color:var(--ui-crit)}
.ui-banner.ui-k-quest .ui-banner-main{background:linear-gradient(to bottom,var(--paper),var(--paper-dim))}
.ui-banner.ui-k-quest .ui-banner-sub{color:var(--ok)}
.ui-banner.ui-k-tech .ui-banner-main,.ui-banner.ui-k-form .ui-banner-main{background:linear-gradient(to bottom,#E6FFFA,var(--accent))}
.ui-banner.ui-k-boss .ui-banner-main{background:linear-gradient(to bottom,#3A2F4F,var(--ink));color:var(--paper);box-shadow:inset 0 -3px 0 var(--danger)}
.ui-banner.ui-k-boss .ui-banner-kicker{color:var(--danger)}
.ui-banner.ui-k-boss .ui-banner-sub{color:var(--paper-dim)}
.ui-banner.ui-k-region .ui-banner-main{background:transparent;color:var(--paper);text-shadow:${OUTLINE};padding-inline:12px;font-size:var(--fs-title)}
.ui-banner.ui-k-region .ui-banner-main::after{display:none}
.ui-banner.ui-k-region .ui-banner-kicker::after{content:"";display:block;margin:4px auto 0;inline-size:60%;block-size:2px;background:var(--paper)}
/* Combat call-outs (Break!, Perfect!, Finisher!) are small, short and beside the action, not on it. */
.ui-cwrap{position:absolute;top:45%;left:74%;inline-size:0;block-size:0;display:flex;align-items:center;justify-content:center}
.ui-m-portrait .ui-cwrap{top:34%;left:70%}
.ui-callout{flex:none;padding:3px 16px 4px;background:var(--danger);color:var(--paper);font:var(--fs-body)/1.1 var(--font-display);white-space:nowrap;
  clip-path:polygon(8px 0,calc(100% - 8px) 0,100% 50%,calc(100% - 8px) 100%,8px 100%,0 50%);opacity:0;transform:scale(.7) rotate(-4deg);transition:opacity 200ms,transform 200ms}
.ui-callout.ui-on{opacity:1;transform:rotate(-4deg);transition:opacity 120ms,transform 260ms cubic-bezier(.2,1.8,.4,1)}
.ui-callout.ui-k-perfect{background:var(--accent);color:var(--ink)}
.ui-callout.ui-k-finisher{background:linear-gradient(to bottom,#FFF6D8,var(--ui-crit));color:var(--ink);font-size:var(--fs-h2)}

/* combo counter: the count grows with each hit, pulses on a rank-up and fades when the chain breaks */
.ui-combo{position:absolute;inset-block-start:calc(var(--safe-top) + 96px);left:calc(var(--safe-left) + 156px);display:grid;grid-template-columns:auto auto;
  align-items:baseline;justify-content:start;column-gap:6px;direction:ltr;text-shadow:${OUTLINE},0 3px 0 var(--ink);pointer-events:none;transform-origin:0 50%}
.ui-combo[hidden]{display:none}
.ui-m-portrait .ui-combo{inset-block-start:38%;left:var(--safe-left)}
/* Touch landscape: the counter takes the quest tracker's place under Gather and Item while a chain runs. */
.ui-hud.ui-touch:not(.ui-m-portrait) .ui-combo{left:var(--safe-left);inset-block-start:calc(100% - env(safe-area-inset-bottom,0px) - 234px)}
.ui-hud.ui-touch.ui-cmb:not(.ui-m-portrait) .ui-tracker{display:none}
.ui-m-desktop .ui-combo{inset-block-start:38%;left:auto;right:calc(var(--safe-right) + 40px);transform-origin:100% 50%}
.ui-combo-n{font:400 34px/1 var(--font-display);color:var(--paper)}
.ui-combo-l{font:400 13px/1 var(--font-display);color:var(--paper-dim);letter-spacing:.06em}
.ui-combo-r{grid-column:1 / span 2;font:400 15px/1.1 var(--font-display);color:var(--accent);letter-spacing:.08em}
.ui-combo[data-rank="2"] .ui-combo-n{color:#FFF1C9}
.ui-combo[data-rank="3"] .ui-combo-n,.ui-combo[data-rank="3"] .ui-combo-r{color:var(--ui-crit)}
.ui-combo[data-rank="4"] .ui-combo-n,.ui-combo[data-rank="4"] .ui-combo-r{color:var(--warn)}
.ui-combo[data-rank="5"] .ui-combo-n,.ui-combo[data-rank="5"] .ui-combo-r{color:#FF8FB0}
.ui-combo[data-rank="3"] .ui-combo-n{font-size:40px}
.ui-combo[data-rank="4"] .ui-combo-n,.ui-combo[data-rank="5"] .ui-combo-n{font-size:46px}
.ui-combo.ui-in{animation:ui-comboin 220ms var(--ui-ease)}
.ui-combo-n.ui-pop{animation:ui-pop 200ms ease-out}
.ui-combo.ui-rankup .ui-combo-r{animation:ui-rankup 520ms ease-out}
.ui-combo.ui-out{opacity:0;transform:translateY(-8px);transition:opacity 320ms,transform 320ms}

/* gains: XP and Shells count up beside Resonance; pickups fly to them */
.ui-gain{display:inline-flex;gap:8px;align-items:baseline;opacity:0;transform:translateX(-6px);transition:opacity 200ms,transform 200ms}
.ui-gain.ui-on{opacity:1;transform:none}
.ui-gain-xp{font-size:calc(var(--resfs) * .78);color:var(--ui-crit)}
.ui-gain-sh{display:inline-flex;gap:2px;align-items:center;color:var(--paper)}
.ui-gain-sh .ui-ico{inline-size:14px;block-size:14px;color:var(--ui-crit)}
.ui-gain-sh bdi{font-size:calc(var(--resfs) * .78)}
.ui-gain [hidden]{display:none}
.ui-fly{position:absolute;left:-5px;top:-5px;inline-size:10px;block-size:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px 2px rgba(127,242,224,.8);
  transition:transform 520ms cubic-bezier(.5,0,.8,.6),opacity 520ms;pointer-events:none}
.ui-fly[hidden]{display:none}
.ui-fly.ui-fly-sh{background:var(--ui-crit);box-shadow:0 0 8px 2px rgba(255,212,90,.8)}
.ui-fly.ui-fly-item{background:var(--paper);box-shadow:0 0 8px 2px rgba(243,235,221,.8)}
.ui-med.ui-burst::after{content:"";position:absolute;inset:-4px;border-radius:50%;box-shadow:0 0 0 3px var(--ui-crit);animation:ui-burst 900ms ease-out}
.ui-med.ui-burst{animation:ui-medpop 500ms ease-out}
.ui-target.ui-phase .ui-bar:not(.ui-tpoise){animation:ui-phase 600ms ease-out}
.ui-skip{position:absolute;inset-block-end:calc(11% + 10px);inset-inline-end:max(16px,env(safe-area-inset-right));display:flex;align-items:center;gap:6px;padding:4px 12px 4px 8px;
  border-radius:16px;background:rgba(27,22,38,.6);color:var(--paper);font:var(--fs-small)/1.2 var(--font-body);pointer-events:none;animation:ui-fadein 400ms 600ms both}
.ui-skip[hidden]{display:none}
.ui-skip .ui-ico{inline-size:16px;block-size:16px}
.ui-flashfx{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,rgba(255,246,216,.55),rgba(255,212,90,.15) 60%,transparent 80%)}
.ui-flashfx.ui-on{animation:ui-flash 380ms ease-out}

.ui-lane{position:absolute;inset-block-end:calc(var(--safe-bottom) + 110px);left:var(--ui-cx);transform:translateX(-50%);inline-size:max-content;max-inline-size:var(--tw);
  display:flex;flex-direction:column-reverse;align-items:center;gap:8px;pointer-events:none;transition:transform 240ms var(--ui-ease)}
.ui-m-portrait .ui-lane{inset-block-end:calc(32% + 10px);max-inline-size:min(320px,calc(100% - 32px))}
.ui-lane.ui-holdt .ui-toasts{display:none}
.ui-banner.ui-held{visibility:hidden}
.ui-m-short .ui-lane{inset-block-end:calc(var(--safe-bottom) + 114px)}
.ui-m-desktop .ui-lane{inset-block-end:16%;max-inline-size:420px}
.ui-lane .ui-pill,.ui-lane .ui-prompt{max-inline-size:100%!important}
.ui-pill{position:relative;flex:none;display:flex;align-items:center;gap:8px;
  min-block-size:44px;max-inline-size:var(--tw);padding:4px 16px 4px 6px;border:0;border-radius:24px;background:var(--panel);color:var(--paper);
  box-shadow:0 0 0 2px var(--ink),inset 0 0 0 1.5px var(--accent);font:500 var(--fs-body)/1.2 var(--font-body);cursor:pointer;pointer-events:auto;
  animation:ui-in 180ms var(--ui-ease)}
.ui-pill[hidden]{display:none}
.ui-pill span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ui-glyph{display:inline-flex;align-items:center;justify-content:center;min-inline-size:32px;block-size:32px;padding:0 7px;border-radius:16px;flex:none;
  background:var(--paper);color:var(--ink);font:13px/1 var(--font-display);direction:ltr}
.ui-glyph.ui-tap{background:transparent;color:var(--accent);box-shadow:inset 0 0 0 2px var(--accent)}
.ui-glyph .ui-ico{inline-size:18px;block-size:18px}

.ui-prompt{position:relative;flex:none;display:flex;gap:10px;align-items:center;
  max-inline-size:var(--tw);padding:5px 14px 5px 6px;border-radius:22px;background:rgba(27,22,38,.72);font-size:var(--fs-small);line-height:1.25;
  text-shadow:0 1px 2px var(--ink);animation:ui-in 180ms var(--ui-ease)}
.ui-prompt[hidden]{display:none}
.ui-m-short .ui-prompt{padding-block:3px}
.ui-m-short .ui-prompt .ui-glyph,.ui-m-short .ui-pill .ui-glyph{min-inline-size:26px;block-size:26px}
.ui-m-short .ui-pill{min-block-size:38px}
.ui-m-desktop .ui-prompt{font-size:var(--fs-body)}
.ui-ghost{position:absolute;left:0;top:0;border-radius:50%;box-shadow:0 0 0 3px var(--accent),0 0 18px 4px rgba(127,242,224,.55);
  animation:ui-ghost 1.1s ease-in-out infinite;pointer-events:none}
.ui-ghost[hidden]{display:none}

.ui-chip{position:absolute;inset-block-start:calc(var(--safe-top) + var(--med) + 12px);inset-inline-start:var(--safe-left);display:flex;align-items:center;gap:6px;
  block-size:44px;padding:0 10px 0 6px;border-radius:22px;background:var(--panel);box-shadow:0 0 0 2px var(--ink)}
.ui-chip[hidden]{display:none}
.ui-chip .ui-glyph{min-inline-size:26px;block-size:26px;font-size:11px}

.ui-saveico{position:absolute;inset-block-end:calc(var(--safe-bottom) - 8px);inset-inline-end:calc(var(--safe-right) - 8px);inline-size:20px;block-size:20px;
  border-radius:50%;border:2px solid transparent;border-top-color:var(--accent);border-right-color:var(--accent);opacity:0;transition:opacity 180ms}
.ui-saveico.ui-on{opacity:1;animation:ui-spin 700ms linear infinite}
.ui-dmg{position:absolute;left:0;top:0;font-family:var(--font-display);font-size:20px;line-height:1;color:var(--paper);white-space:nowrap;
  text-shadow:-2px 0 var(--ink),2px 0 var(--ink),0 -2px var(--ink),0 2px var(--ink),-1px -1px var(--ink),1px 1px var(--ink),-1px 1px var(--ink),1px -1px var(--ink);
  will-change:transform,opacity;direction:ltr}
.ui-dmg[hidden]{display:none}
.ui-dmg.ui-crit{color:var(--ui-crit);font-size:26px}
.ui-dmg.ui-crit::after{content:"!";margin-inline-start:1px}
.ui-dmg.ui-strong{color:#FFE7C2;font-size:24px}
.ui-dmg.ui-hurt{color:var(--ui-hurt);font-size:16px}
.ui-dmg.ui-blocked{color:var(--paper-dim);font-size:15px}
.ui-m-portrait .ui-dmg{font-size:17px}
.ui-m-portrait .ui-dmg.ui-crit{font-size:22px}
.ui-letter{position:absolute;inset-inline:0;block-size:11%;background:#000;transition:transform 400ms var(--ui-ease);pointer-events:none}
.ui-letter.ui-top{inset-block-start:0;transform:translateY(-101%)}
.ui-letter.ui-bot{inset-block-end:0;transform:translateY(101%)}
.ui-letterbox .ui-letter{transform:none}
.ui-fade{position:absolute;inset:0;background:var(--ink);opacity:0;pointer-events:none;transition-property:opacity;transition-timing-function:linear}
.ui-vignette{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 300ms;background:radial-gradient(ellipse at center,transparent 55%,rgba(232,80,91,.45) 100%)}
.ui-vignette.ui-on{opacity:1;animation:ui-heartv 900ms ease-in-out infinite}

/* ------------------------------------------------------------------ screens */
.ui-scr{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;
  padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));
  background:var(--ui-dim);animation:ui-fadein 180ms ease-out;overflow:hidden}
.ui-scr[hidden]{display:none}
.ui-scr.ui-closing{animation:ui-fadeout 120ms ease-in forwards;pointer-events:none}
.ui-scr.ui-closing .ui-panel{animation:ui-outp 120ms ease-in forwards}
.ui-scr.ui-tabin .ui-panel{animation:ui-slidel 180ms var(--ui-ease)}
.ui-scr.ui-tabin-r .ui-panel{animation:ui-slider 180ms var(--ui-ease)}
.ui-scr.ui-tabin,.ui-scr.ui-tabin-r{animation:none}
.ui-li:active,.ui-cell:active,.ui-slot:active,.ui-chipbtn:active,.ui-tab:active,.ui-langpill button:active{transform:scale(.96)}
.ui-li,.ui-cell,.ui-slot,.ui-chipbtn,.ui-tab{transition:transform 80ms ease-out,background-color 120ms,box-shadow 120ms}
.ui-chipbtn[disabled],.ui-li[disabled],.ui-slot[disabled]{opacity:.42;cursor:default;transform:none}
.ui-scr.ui-menuscr{background:rgba(27,22,38,.88)}
.ui-scr.ui-solid{background:var(--ink)}
.ui-scr.ui-clear{background:transparent}
.ui-scr.ui-low{align-items:flex-end}
.ui-panel{position:relative;display:flex;flex-direction:column;inline-size:100%;max-inline-size:600px;max-block-size:100%;min-block-size:0;
  filter:drop-shadow(4px 4px 0 var(--ui-slab));animation:ui-in 180ms var(--ui-ease)}
.ui-panel.ui-wide{max-inline-size:900px}
.ui-panel.ui-narrow{max-inline-size:420px}
.ui-pin{display:flex;flex-direction:column;min-block-size:0;flex:1;padding:2px;background:var(--ink);clip-path:${CUT}}
#app[dir=rtl] .ui-pin{clip-path:${CUT_RTL}}
.ui-pbody{position:relative;display:flex;flex-direction:column;gap:12px;min-block-size:0;flex:1;padding:16px 18px 18px;overflow:auto;overscroll-behavior:contain;
  background:linear-gradient(to bottom,rgba(58,47,79,.96),rgba(36,29,51,.97));clip-path:${CUT};box-shadow:inset 0 0 0 1px var(--line);scrollbar-width:thin}
#app[dir=rtl] .ui-pbody{clip-path:${CUT_RTL}}
.ui-ribbon{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;margin:0;margin-inline-start:-18px;padding:5px 26px 5px 18px;background:var(--paper);color:var(--ink);
  font-family:var(--font-display);font-size:var(--fs-h2);line-height:1.2;font-weight:400;clip-path:polygon(0 0,100% 0,calc(100% - 10px) 50%,100% 100%,0 100%)}
#app[dir=rtl] .ui-ribbon{clip-path:polygon(0 0,100% 0,100% 100%,0 100%,10px 50%);padding:5px 18px 5px 26px}
.ui-ribbon .ui-ico{inline-size:20px;block-size:20px}
.ui-h3{margin:0;font-family:var(--font-display);font-size:var(--fs-body);font-weight:400;color:var(--paper-dim);letter-spacing:.04em}
.ui-p{margin:0;font-size:var(--fs-body);line-height:1.45;color:var(--paper)}
.ui-small{font-size:var(--fs-small);color:var(--paper-dim);line-height:1.4}
.ui-devrep{margin:0;padding:10px;background:var(--ink);border:1px solid var(--line);color:var(--paper);font:12px/1.5 ui-monospace,monospace;direction:ltr;text-align:left;white-space:pre-wrap;word-break:break-word;user-select:text;-webkit-user-select:text}
.ui-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ui-col{display:flex;flex-direction:column;gap:8px;min-inline-size:0}
.ui-spread{display:flex;gap:8px;align-items:center;justify-content:space-between}
.ui-grow{flex:1;min-inline-size:0}
.ui-sep{block-size:2px;background:linear-gradient(to right,transparent,var(--line),transparent);border:0;margin:2px 0}

.ui-scr [hidden],.ui-btn[hidden]{display:none!important}
.ui-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-block-size:48px;min-inline-size:48px;padding:0 18px;border:0;
  background:var(--paper);color:var(--ink);font-family:var(--font-display);font-size:var(--fs-body);line-height:1.1;cursor:pointer;text-align:center;
  clip-path:${CUT_S};transition:transform 80ms ease-out,background-color 120ms;touch-action:manipulation}
#app[dir=rtl] .ui-btn{clip-path:${CUT_S_RTL}}
.ui-btn:hover{background:#FFF8EC}
.ui-btn.ui-press{animation:ui-press 160ms ease-out}
.ui-btn:active{transform:scale(.94)}
.ui-btn[disabled]{opacity:.42;cursor:default;filter:saturate(.3);transform:none}
.ui-btn.ui-ghostbtn{background:rgba(243,235,221,.08);color:var(--paper);box-shadow:inset 0 0 0 2px rgba(243,235,221,.45)}
.ui-btn.ui-ghostbtn:hover{background:rgba(243,235,221,.16)}
.ui-btn.ui-accent{background:var(--accent)}
.ui-btn.ui-danger{background:var(--danger);color:var(--paper)}
.ui-btn.ui-sm{min-block-size:40px;min-inline-size:40px;padding:0 12px;font-size:var(--fs-small)}
.ui-btn.ui-icon{padding:0;inline-size:48px}
.ui-btn.ui-full{inline-size:100%}
.ui-btn.ui-left{justify-content:flex-start}
.ui-btn-label{min-inline-size:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.1;padding-block:2px}
.ui-kbd .ui-focus{outline:3px solid var(--accent);outline-offset:3px;z-index:1}
.ui-kbd .ui-btn.ui-focus{clip-path:none;box-shadow:0 0 0 3px var(--ink),0 0 0 6px var(--accent);outline:0}

.ui-tabs{display:flex;gap:4px;padding:0;margin:0;overflow:hidden;flex:none}
.ui-tab{flex:1 1 0;min-inline-size:0;display:flex;align-items:center;justify-content:center;gap:6px;min-block-size:44px;padding:0 8px;border:0;
  background:rgba(243,235,221,.07);color:var(--paper-dim);font:var(--fs-small)/1.1 var(--font-display);cursor:pointer;box-shadow:inset 0 -2px 0 rgba(243,235,221,.15)}
.ui-tab .ui-ico{inline-size:20px;block-size:20px}
.ui-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ui-tab.ui-sel{background:var(--paper);color:var(--ink);box-shadow:none}
.ui-tabs.ui-iconic .ui-tab span{display:none}
.ui-tabhint{display:inline-flex;align-items:center;justify-content:center;flex:none;min-inline-size:28px;font:11px/1 var(--font-display);color:var(--paper-dim)}

.ui-card{position:relative;padding:10px 12px;background:rgba(27,22,38,.55);box-shadow:inset 0 0 0 1px var(--line);clip-path:${CUT_S}}
#app[dir=rtl] .ui-card{clip-path:${CUT_S_RTL}}
.ui-list{display:flex;flex-direction:column;gap:6px}
.ui-li{display:flex;align-items:center;gap:10px;min-block-size:56px;padding:6px 10px;border:0;background:rgba(27,22,38,.5);color:var(--paper);text-align:start;
  font:inherit;cursor:pointer;box-shadow:inset 0 0 0 1px var(--line)}
.ui-li.ui-sel{box-shadow:inset 0 0 0 2px var(--accent);background:rgba(127,242,224,.08)}
.ui-li[disabled]{opacity:.5;cursor:default}
.ui-tree{gap:10px}
.ui-node{position:relative;overflow:visible}
.ui-node::before{content:"";position:absolute;inset-inline-start:31px;inset-block-start:-11px;block-size:11px;inline-size:2px;background:var(--line)}
.ui-node:first-child::before{display:none}
.ui-node.ui-st-owned::before{background:var(--accent)}
.ui-node.ui-st-locked{background:rgba(27,22,38,.35)}
.ui-node.ui-st-locked .ui-li-title{color:var(--paper-dim)}
.ui-node.ui-st-locked .ui-ringico{opacity:.6}
.ui-node.ui-st-avail .ui-ringico{animation:ui-avail 1.8s ease-in-out infinite}
.ui-nodebadge{position:absolute;inset-block-end:-4px;inset-inline-end:-4px;inline-size:18px;block-size:18px;border-radius:50%;background:var(--ink);
  display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 1.5px var(--rc,var(--line))}
.ui-nodebadge .ui-ico{inline-size:12px;block-size:12px}
.ui-st-owned .ui-nodebadge{color:var(--accent)}
.ui-st-locked .ui-nodebadge{color:var(--paper-dim)}
.ui-reduced .ui-node.ui-st-avail .ui-ringico{animation:none}
.ui-li-main{flex:1;min-inline-size:0;display:flex;flex-direction:column;gap:2px}
.ui-li-title{font-family:var(--font-display);font-size:var(--fs-body);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ui-li-sub{font-size:var(--fs-small);color:var(--paper-dim);line-height:1.3}
.ui-ringico{position:relative;flex:none;inline-size:44px;block-size:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  color:var(--paper);background:radial-gradient(circle,#3A2F4F 0,var(--ink) 75%);box-shadow:0 0 0 2px var(--rc,var(--line))}
.ui-sel .ui-ringico,.ui-focus .ui-ringico{box-shadow:0 0 0 2px var(--rc,var(--line)),0 0 0 5px var(--accent)}
.ui-letterb{position:absolute;inset-block-end:-4px;inset-inline-end:-4px;inline-size:18px;block-size:18px;border-radius:50%;background:var(--rc,var(--paper));color:var(--ink);
  font:11px/18px var(--font-display);text-align:center;box-shadow:0 0 0 2px var(--ink)}
.ui-r-common{--rc:var(--rarity-c)}
.ui-r-fine{--rc:var(--rarity-f)}
.ui-r-rare{--rc:var(--rarity-r)}
.ui-pips{display:inline-flex;gap:3px}
.ui-pips i{inline-size:8px;block-size:8px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--paper-dim)}
.ui-pips i.ui-on{background:var(--accent);box-shadow:none}
.ui-tag{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;background:rgba(243,235,221,.1);font-size:12px;line-height:1.3;color:var(--paper-dim);white-space:nowrap}
.ui-tag.ui-ok{color:var(--ok)}
.ui-tag.ui-bad{color:var(--danger)}
.ui-tag .ui-ico{inline-size:14px;block-size:14px}
.ui-up{color:var(--ok)}
.ui-down{color:var(--danger)}
.ui-kv{display:grid;grid-template-columns:1fr auto;gap:4px 14px;margin:0;font-size:var(--fs-small);line-height:1.35}
.ui-kv dt{color:var(--paper-dim);margin:0}
.ui-kv dd{margin:0;text-align:end;font-family:var(--font-display)}
.ui-empty{padding:18px;text-align:center;color:var(--paper-dim);font-size:var(--fs-small)}

.ui-big{margin:0;font-family:var(--font-display);font-size:var(--fs-banner);line-height:1.05;text-align:center;font-weight:400}
.ui-chips{display:flex;flex-wrap:wrap;gap:6px}
.ui-chipbtn{min-block-size:40px;padding:0 14px;border:0;border-radius:20px;background:rgba(243,235,221,.08);color:var(--paper);font:var(--fs-small)/1 var(--font-display);
  cursor:pointer;box-shadow:inset 0 0 0 1.5px rgba(243,235,221,.4)}
.ui-chipbtn.ui-sel{background:var(--accent);color:var(--ink);box-shadow:none}
.ui-field{display:flex;align-items:center;justify-content:space-between;gap:12px;min-block-size:52px;padding:4px 0;border-block-end:1px solid rgba(74,63,92,.7)}
.ui-field > span{flex:1;min-inline-size:0;font-size:var(--fs-body)}
.ui-range{inline-size:min(200px,46%);accent-color:var(--accent);block-size:32px;cursor:pointer}
.ui-switch{position:relative;flex:none;inline-size:56px;block-size:32px;border:0;border-radius:16px;background:rgba(243,235,221,.18);cursor:pointer;padding:0}
.ui-switch::after{content:"";position:absolute;inset-block-start:4px;inset-inline-start:4px;inline-size:24px;block-size:24px;border-radius:50%;background:var(--paper-dim);
  transition:transform 120ms var(--ui-ease)}
.ui-switch.ui-on{background:var(--accent)}
.ui-switch.ui-on::after{background:var(--ink);transform:translateX(24px)}
#app[dir=rtl] .ui-switch.ui-on::after{transform:translateX(-24px)}
.ui-text{inline-size:100%;min-block-size:96px;padding:10px;border:2px solid var(--line);background:var(--ink);color:var(--paper);resize:none;
  font:12px/1.4 ui-monospace,monospace;direction:ltr;text-align:left;word-break:break-all}

/* title and loading */
.ui-scr.ui-title{flex-direction:column;justify-content:space-between;align-items:stretch;background:linear-gradient(to bottom,rgba(27,22,38,.62),rgba(27,22,38,.3) 22%,rgba(27,22,38,0) 42%,rgba(27,22,38,.75))}
.ui-logo{display:flex;flex-direction:column;align-items:center;gap:2px;margin-block-start:4vh;padding:10px 28px 14px;align-self:center;text-align:center;
  background:radial-gradient(ellipse closest-side,rgba(27,22,38,.8),rgba(27,22,38,.55) 55%,rgba(27,22,38,0))}
.ui-logo-main{position:relative;margin:0;padding:0 .12em .08em;font:700 clamp(48px,12vw,104px)/1 var(--font-display);color:var(--paper);letter-spacing:.03em;
  text-shadow:-2px -2px 0 var(--ink),2px -2px 0 var(--ink),-2px 2px 0 var(--ink),2px 2px 0 var(--ink),0 5px 0 var(--ink),0 0 18px rgba(127,242,224,.8),0 0 40px rgba(27,22,38,.9);overflow:hidden}
.ui-logo-main::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 35%,rgba(255,255,255,.55) 50%,transparent 65%);
  transform:translateX(-120%);animation:ui-sweep 5s ease-in-out 1s infinite;mix-blend-mode:overlay}
.ui-logo{position:relative;isolation:isolate}
.ui-logo-main{animation:ui-float 7s ease-in-out infinite}
.ui-logo-ring{position:absolute;z-index:-1;left:50%;top:50%;inline-size:min(64vw,270px);block-size:min(64vw,270px);margin:calc(min(64vw,270px) / -2) 0 0 calc(min(64vw,270px) / -2);
  fill:none;stroke-linecap:round;opacity:.9;filter:drop-shadow(0 0 6px rgba(127,242,224,.55))}
.ui-logo-ring g{transform-origin:100px 100px;animation:ui-spinslow 60s linear infinite}
.ui-logo-ring .a{stroke:var(--accent);stroke-dasharray:120 14 40 14}
.ui-logo-ring .b{stroke:var(--paper);opacity:.55;stroke-dasharray:3 7}
.ui-logo-ring .t{stroke:var(--ui-crit);stroke-width:2.5;opacity:.85}
.ui-reduced .ui-logo-main,.ui-reduced .ui-logo-ring g{animation:none}
@media (prefers-reduced-motion:reduce){.ui-logo-main,.ui-logo-ring g{animation:none}}
.ui-logo-sub{font:400 clamp(16px,3.4vw,24px)/1.2 var(--font-display);color:var(--accent);text-shadow:${OUTLINE},0 2px 0 var(--ink);letter-spacing:.06em}
.ui-logo-alt{font-size:var(--fs-small);color:var(--paper);text-shadow:${OUTLINE}}
.ui-menu{display:flex;flex-direction:column;gap:8px;inline-size:min(340px,100%);align-self:center;margin-block-end:2vh}
.ui-titlerow{justify-content:center;gap:10px}
.ui-credhead{display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center}
.ui-credname{font:400 clamp(34px,9vw,52px)/1 var(--font-display);color:var(--paper);letter-spacing:.04em;text-shadow:0 3px 0 var(--ink),0 0 18px rgba(127,242,224,.5)}
.ui-legal{margin:0;font:11px/1.45 var(--font-body);color:var(--paper-dim);direction:ltr;text-align:left;unicode-bidi:isolate}
.ui-langpill{align-self:center;display:flex;gap:0;border-radius:22px;overflow:hidden;box-shadow:0 0 0 2px var(--paper)}
.ui-langpill button{min-block-size:40px;min-inline-size:56px;border:0;background:var(--panel);color:var(--paper);font:15px/1 var(--font-display);cursor:pointer}
.ui-langpill button.ui-sel{background:var(--paper);color:var(--ink)}
.ui-load{flex-direction:column;gap:18px;text-align:center}
.ui-load-ring{position:relative;inline-size:min(180px,40vmin);block-size:min(180px,40vmin)}
.ui-load-ring svg.ui-lr{position:absolute;inset:0;inline-size:100%;block-size:100%;transform:rotate(-90deg)}
.ui-load-ring circle{fill:none;stroke-width:5}
.ui-load-ring canvas{position:absolute;inset:16%;inline-size:68%;block-size:68%;border-radius:50%;opacity:.85}
.ui-load-pct{font:400 var(--fs-title)/1 var(--font-display)}
.ui-load-tip{max-inline-size:min(480px,90vw);min-block-size:2.8em;color:var(--paper-dim);font-size:var(--fs-small)}

/* character, inventory, techniques, shop, map */
.ui-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:14px;min-block-size:0}
.ui-three{display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.1fr) minmax(0,1fr);gap:12px;min-block-size:0;align-items:start}
.ui-eqslots{grid-template-columns:minmax(0,1fr)}
.ui-tabs.ui-grow{flex:1 1 0;min-inline-size:0}
.ui-char{grid-template-areas:"hero main" "der main";align-items:start}
.ui-char .ui-hero{grid-area:hero}
.ui-char .ui-der{grid-area:der}
.ui-char .ui-main{grid-area:main}
.ui-eqslots .ui-slot{min-block-size:52px}
.ui-portrait-only{display:none}
/* character: the hero, framed by the game camera, shows through the hero card */
.ui-scr.ui-charscr.ui-live{background:linear-gradient(to bottom,rgba(27,22,38,.55),rgba(27,22,38,.25) 40%,rgba(27,22,38,.55))}
.ui-charscr.ui-live .ui-pbody{background:transparent;box-shadow:none}
.ui-charscr.ui-live .ui-pin{background:transparent}
.ui-charscr.ui-live .ui-pbody > .ui-spread,.ui-charscr.ui-live .ui-main,.ui-charscr.ui-live .ui-der{padding:10px 12px;background:linear-gradient(to bottom,rgba(58,47,79,.96),rgba(36,29,51,.97));
  box-shadow:inset 0 0 0 1px var(--line)}
.ui-charscr.ui-live .ui-hero{background:linear-gradient(to top,rgba(27,22,38,.85),transparent 45%);box-shadow:inset 0 0 0 2px rgba(243,235,221,.35);justify-content:flex-end;min-block-size:240px}
.ui-charscr.ui-live .ui-hero-sil{display:none}
@media (max-width:560px){.ui-charscr.ui-live .ui-hero{min-block-size:220px;flex-direction:column;align-items:center}}
@media (max-height:440px){.ui-charscr.ui-live .ui-hero{min-block-size:0;block-size:100%}}
.ui-statline{display:flex;align-items:center;gap:10px;min-block-size:52px;padding:2px 0;border-block-end:1px solid rgba(74,63,92,.7)}
.ui-statline > .ui-grow{display:flex;flex-direction:column}
.ui-stat-name{font-family:var(--font-display);font-size:var(--fs-body)}
.ui-stat-val{font-family:var(--font-display);font-size:1.35rem;min-inline-size:44px;text-align:center}
.ui-hero{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;background:radial-gradient(circle at 50% 30%,rgba(127,242,224,.18),transparent 70%)}
.ui-hero-sil{inline-size:96px;block-size:96px;color:var(--accent)}
.ui-hero-sil .ui-ico{inline-size:100%;block-size:100%;stroke-width:1.2}
.ui-resbig{font:400 2rem/1 var(--font-display);color:var(--paper);text-shadow:0 0 14px rgba(127,242,224,.45)}
.ui-slots{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.ui-slot{display:flex;align-items:center;gap:8px;min-block-size:64px;padding:6px 8px;border:0;background:rgba(27,22,38,.55);color:var(--paper);font:inherit;
  text-align:start;cursor:pointer;box-shadow:inset 0 0 0 1px var(--line)}
.ui-slot .ui-li-sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ui-cells{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px}
.ui-cell{position:relative;block-size:64px;border:0;background:rgba(27,22,38,.55);display:flex;align-items:center;justify-content:center;cursor:pointer;
  box-shadow:inset 0 0 0 1px var(--line);padding:0;color:var(--paper)}
.ui-cell.ui-sel{box-shadow:inset 0 0 0 2px var(--accent)}
.ui-cell .ui-cnt{position:absolute;inset-block-end:2px;inset-inline-end:4px;font:12px/1 var(--font-display)}
.ui-cmp{position:absolute;inset-block-start:3px;inset-inline-end:3px;inline-size:16px;block-size:16px;border-radius:50%;background:var(--ink);display:flex;align-items:center;justify-content:center}
.ui-cmp .ui-ico{inline-size:12px;block-size:12px}
.ui-cell.ui-r-fine,.ui-cell.ui-r-rare{background:radial-gradient(circle at 50% 60%,color-mix(in srgb,var(--rc) 22%,transparent),rgba(27,22,38,.55) 70%)}
.ui-cell .ui-eq{position:absolute;inset-block-start:3px;inset-inline-start:3px;inline-size:14px;block-size:14px;color:var(--accent)}
.ui-sheet{display:flex;flex-direction:column;gap:8px}
.ui-mapwrap{position:relative;inline-size:min(100%,calc(100vh - 150px));aspect-ratio:1;align-self:center;overflow:hidden;
  background:#E9DCC0;box-shadow:0 0 0 2px var(--ink),0 0 0 5px var(--paper-dim);touch-action:none;cursor:grab}
.ui-mapinner{position:absolute;inset:0;transform-origin:0 0}
.ui-mapinner canvas{inline-size:100%;block-size:100%;display:block}
.ui-mapico{position:absolute;inline-size:18px;block-size:18px;margin:-9px 0 0 -9px;color:var(--ink);display:flex}
.ui-mapico .ui-ico{inline-size:18px;block-size:18px;stroke-width:2.4}
.ui-mapico.ui-q{color:var(--map-quest)}
.ui-mapico.ui-q.ui-tracked{color:var(--danger);filter:drop-shadow(0 0 2px #F3EBDD)}
.ui-mapico.ui-q.ui-tracked .ui-ico{animation:ui-mapq 1.4s ease-in-out infinite}
.ui-legend .ui-tag{white-space:normal}
.ui-trk{color:var(--ui-crit)}
.ui-mapico.ui-s,.ui-legico.ui-s .ui-ico{color:var(--map-siphon)}
.ui-mapico.ui-r,.ui-legico.ui-r .ui-ico{color:var(--map-ring)}
.ui-legico.ui-q .ui-ico{color:var(--map-quest)}
.ui-mapico.ui-c{color:var(--map-camp)}
.ui-mapico.ui-k{color:var(--map-chest)}
/* Places of a revealed region not visited yet: faded, on a dashed ring. Sleeping Ringstones: grey. */
.ui-mapico.ui-unseen{opacity:.62;border-radius:50%;outline:1.5px dashed currentColor;outline-offset:1px;transform:scale(.8)}
.ui-legico.ui-unseen .ui-ico{opacity:.7;border-radius:50%;outline:1.5px dashed currentColor;outline-offset:-1px}
.ui-mapico.ui-asleep,.ui-legico.ui-asleep .ui-ico{color:var(--map-sleep)}
/* Awake Ringstones: a filled disc, a pulse ring, and a 44 px tap area around the 18 px icon. */
.ui-mapico.ui-awake{background:var(--paper);border-radius:50%;box-shadow:0 0 0 2px var(--map-ring);cursor:pointer}
.ui-mapico.ui-awake::before{content:'';position:absolute;inset:-13px;border-radius:50%}
.ui-mapico.ui-v,.ui-legico.ui-v .ui-ico{color:var(--map-view)}
.ui-mapico.ui-shard{inline-size:12px;block-size:12px;margin:-6px 0 0 -6px;color:var(--map-shard)}
.ui-mapico.ui-shard .ui-ico{inline-size:12px;block-size:12px;stroke-width:3}
.ui-sharddot{display:inline-block;inline-size:8px;block-size:8px;background:var(--accent);transform:rotate(45deg);flex:none}
.ui-tab[hidden]{display:none}
.ui-medal{--rc:var(--line)}
.ui-medal.ui-medal-gold,.ui-medaltag.ui-medal-gold{--rc:var(--ui-crit);color:var(--ui-crit)}
.ui-medal.ui-medal-silver,.ui-medaltag.ui-medal-silver{--rc:var(--paper-dim);color:var(--paper)}
.ui-medal.ui-medal-bronze,.ui-medaltag.ui-medal-bronze{--rc:var(--ui-chip);color:var(--ui-chip)}
.ui-mapnote{align-self:center;white-space:normal}
.ui-mapnote[hidden]{display:none}
.ui-maplabel{position:absolute;transform:translate(-50%,8px);font:11px/1 var(--font-display);color:var(--ink);white-space:nowrap;text-shadow:0 0 3px #F3EBDD,0 0 3px #F3EBDD}
.ui-maparrow{position:absolute;inline-size:22px;block-size:22px;margin:-11px 0 0 -11px;color:var(--danger);filter:drop-shadow(0 0 2px var(--paper))}
.ui-maparrow .ui-ico{inline-size:22px;block-size:22px}
.ui-tracks{display:flex;align-items:center;justify-content:center;gap:4px}
.ui-qstep{display:flex;gap:8px;align-items:flex-start;font-size:var(--fs-small);line-height:1.4}
.ui-qstep .ui-ico{inline-size:16px;block-size:16px;margin-block-start:2px;color:var(--ui-crit)}
.ui-checklist{display:flex;flex-direction:column;gap:6px;padding-inline-start:2px}
.ui-qstep.ui-done{color:var(--paper-dim)}
.ui-qstep.ui-done span{text-decoration:line-through;text-decoration-color:rgba(217,205,184,.45)}
.ui-qstep.ui-done .ui-ico{color:var(--ok)}
.ui-qstep.ui-cur{color:var(--paper);font-size:var(--fs-body)}

/* dialogue */
.ui-dlg{align-items:flex-end;background:linear-gradient(to bottom,transparent 45%,rgba(27,22,38,.55))}
.ui-dlgpanel{position:relative;inline-size:100%;max-inline-size:720px;margin-block-start:24px;filter:drop-shadow(4px 4px 0 var(--ui-slab));cursor:pointer}
.ui-dlgname{position:absolute;inset-block-start:-24px;inset-inline-start:14px;z-index:1;padding:4px 22px 4px 14px;background:var(--paper);color:var(--ink);
  font:400 var(--fs-body)/1.2 var(--font-display);clip-path:polygon(0 0,100% 0,calc(100% - 10px) 50%,100% 100%,0 100%)}
#app[dir=rtl] .ui-dlgname{clip-path:polygon(0 0,100% 0,100% 100%,0 100%,10px 50%);padding:4px 14px 4px 22px}
.ui-dlgname[hidden]{display:none}
.ui-dlgline{margin:0;min-block-size:4.4em;font-size:var(--fs-body);line-height:1.47}
.ui-dlgmore{position:absolute;inset-block-end:10px;inset-inline-end:14px;inline-size:12px;block-size:12px;color:var(--accent);animation:ui-bob 900ms ease-in-out infinite}
.ui-dlgmore[hidden]{display:none}
/* Skip takes the corner of the HUD's map and pause buttons, which hide while a conversation is open. */
.ui-talking .ui-hud .ui-endbar{visibility:hidden}
.ui-btn.ui-dlgskip{position:absolute;inset-block-start:var(--safe-top);inset-inline-end:var(--safe-right);
  min-block-size:48px;min-inline-size:48px;gap:6px;padding-inline:12px 14px;background:rgba(27,22,38,.55);opacity:.88}
.ui-dlgskip .ui-glyph{min-inline-size:28px;block-size:24px;font-size:11px}
.ui-dlgskip[hidden],.ui-dlgskip .ui-glyph[hidden]{display:none}
.ui-choices{display:flex;flex-direction:column;gap:6px}
.ui-choices .ui-btn{justify-content:flex-start;min-block-size:48px}

/* death and ending */
.ui-scr.ui-death{flex-direction:column;gap:20px;background:radial-gradient(ellipse at center,rgba(27,22,38,.25),rgba(27,22,38,.85));animation:ui-fadein 800ms ease-out}
.ui-death .ui-big{color:var(--paper);text-shadow:0 3px 0 var(--ink),0 0 30px rgba(232,80,91,.4)}
.ui-scr.ui-ending{flex-direction:column;gap:14px;text-align:center;background:radial-gradient(ellipse at center,rgba(27,22,38,.72),rgba(27,22,38,.9))}
.ui-ending .ui-big{color:var(--paper);text-shadow:${OUTLINE},0 3px 0 var(--ink),0 0 28px rgba(127,242,224,.5)}
.ui-ending .ui-logo-sub{text-shadow:${OUTLINE}}
.ui-credits{display:flex;flex-direction:column;gap:6px;max-inline-size:520px;padding-inline:16px;color:var(--paper);font-size:var(--fs-small);text-shadow:${OUTLINE}}
.ui-fatalmsg{margin:0;padding:10px;max-block-size:34vh;overflow:auto;background:var(--ink);border:1px solid var(--line);font:var(--fs-small)/1.4 ui-monospace,monospace;
  white-space:pre-wrap;word-break:break-word;direction:ltr;text-align:left}
.ui-controls{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px 14px}
.ui-ctlrow{display:flex;align-items:center;gap:10px;min-block-size:36px;font-size:var(--fs-small)}
.ui-ctlrow .ui-glyph{min-inline-size:48px;block-size:28px;font-size:12px}
.ui-diagram{position:relative;inline-size:100%;aspect-ratio:16/9;max-block-size:46vh;background:rgba(27,22,38,.5);box-shadow:inset 0 0 0 1px var(--line);overflow:hidden}
.ui-dg{position:absolute;border-radius:50%;box-shadow:inset 0 0 0 2px var(--paper-dim);display:flex;align-items:center;justify-content:center;
  font:10px/1.1 var(--font-display);color:var(--paper);text-align:center;transform:translate(-50%,-50%);overflow:hidden;padding:2px}

/* narrow and short screens */
@media (max-width:560px){
  .ui-two,.ui-three{grid-template-columns:minmax(0,1fr)}
  .ui-char{grid-template-areas:"hero" "main" "der"}
  .ui-eqslots{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ui-pbody{padding:14px 14px 16px}
  .ui-ribbon{margin-inline-start:-14px}
  .ui-portrait-only{display:block}
  .ui-hero{flex-direction:row;justify-content:space-between;padding:8px}
  .ui-hero-sil{inline-size:56px;block-size:56px}
}
@media (max-height:440px){
  .ui-ringico{inline-size:36px;block-size:36px}
  .ui-eqslots .ui-slot,.ui-slot{min-block-size:46px;padding:4px 6px}
  .ui-cells{grid-template-columns:repeat(auto-fill,minmax(56px,1fr))}
  .ui-cell{block-size:56px}
  /* character: the hero, framed by the game camera, shows through the hero card */
.ui-scr.ui-charscr.ui-live{background:linear-gradient(to bottom,rgba(27,22,38,.55),rgba(27,22,38,.25) 40%,rgba(27,22,38,.55))}
.ui-charscr.ui-live .ui-pbody{background:transparent;box-shadow:none}
.ui-charscr.ui-live .ui-pin{background:transparent}
.ui-charscr.ui-live .ui-pbody > .ui-spread,.ui-charscr.ui-live .ui-main,.ui-charscr.ui-live .ui-der{padding:10px 12px;background:linear-gradient(to bottom,rgba(58,47,79,.96),rgba(36,29,51,.97));
  box-shadow:inset 0 0 0 1px var(--line)}
.ui-charscr.ui-live .ui-hero{background:linear-gradient(to top,rgba(27,22,38,.85),transparent 45%);box-shadow:inset 0 0 0 2px rgba(243,235,221,.35);justify-content:flex-end;min-block-size:240px}
.ui-charscr.ui-live .ui-hero-sil{display:none}
@media (max-width:560px){.ui-charscr.ui-live .ui-hero{min-block-size:220px;flex-direction:column;align-items:center}}
@media (max-height:440px){.ui-charscr.ui-live .ui-hero{min-block-size:0;block-size:100%}}
.ui-statline{min-block-size:46px}
  .ui-pbody{padding:10px 14px 12px;gap:8px}
  .ui-ribbon{font-size:var(--fs-body);padding-block:3px}
  .ui-big{font-size:var(--fs-title)}
  .ui-logo{margin-block-start:0}
  .ui-logo-main{font-size:clamp(36px,9vh,64px)}
  .ui-menu{gap:6px}
  .ui-menu .ui-btn{min-block-size:42px}
  .ui-li{min-block-size:48px}
  .ui-hero-sil{inline-size:56px;block-size:56px}
  .ui-dlgline{min-block-size:2.9em}
  .ui-mapwrap{inline-size:min(100%,calc(100vh - 120px))}
  .ui-menugrid .ui-btn,.ui-two .ui-btn{min-block-size:42px}
  .ui-resbig{font-size:1.5rem}
}
@media (max-width:760px){.ui-tabs .ui-tab.ui-hasico:not(.ui-sel) span{display:none}.ui-tabs .ui-tab.ui-hasico:not(.ui-sel){flex:0 0 48px}}
@media (max-width:420px){.ui-tabs .ui-tab.ui-hasico span{display:none}.ui-tabs .ui-tab.ui-hasico,.ui-tabs .ui-tab.ui-hasico.ui-sel{flex:1 1 0;min-inline-size:40px}}
.ui-looks .ui-slot{align-items:center;min-block-size:0;padding-block:6px}
.ui-looks .ui-li-title,.ui-looks .ui-li-sub{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}
.ui-looks .ui-li-sub{font-size:var(--fs-small);line-height:1.2}
@media (max-height:440px){.ui-looks .ui-ringico{inline-size:30px;block-size:30px;flex:0 0 30px}.ui-looks{gap:6px}}
.ui-title .ui-ghostbtn{background:var(--panel);box-shadow:inset 0 0 0 2px rgba(243,235,221,.55)}

@keyframes ui-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes ui-fadeout{from{opacity:1}to{opacity:0}}
@keyframes ui-outp{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px) scale(.98)}}
@keyframes ui-slidel{from{opacity:.2;transform:translateX(28px)}to{opacity:1;transform:none}}
@keyframes ui-slider{from{opacity:.2;transform:translateX(-28px)}to{opacity:1;transform:none}}
@keyframes ui-fadein{from{opacity:0}to{opacity:1}}
@keyframes ui-press{0%{transform:scale(1)}40%{transform:scale(.94);box-shadow:0 0 0 0 rgba(127,242,224,.8)}100%{transform:scale(1);box-shadow:0 0 0 10px rgba(127,242,224,0)}}
@keyframes ui-pulse{0%,100%{box-shadow:0 0 0 2px var(--ink),0 0 0 2px rgba(255,181,71,.6)}50%{box-shadow:0 0 0 2px var(--ink),0 0 0 6px rgba(255,181,71,0)}}
@keyframes ui-ghost{0%,100%{transform:var(--gt) scale(1);opacity:.95}50%{transform:var(--gt) scale(1.12);opacity:.55}}
@keyframes ui-spin{to{transform:rotate(360deg)}}
@keyframes ui-lowhp{0%,100%{filter:none}50%{filter:brightness(1.5)}}
@keyframes ui-resflash{0%{color:var(--accent);text-shadow:0 0 12px var(--accent)}100%{color:var(--paper)}}
@keyframes ui-sweep{0%,60%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
@keyframes ui-barhit{0%{filter:brightness(2.2)}100%{filter:none}}
@keyframes ui-spent{0%{opacity:1}100%{opacity:.35}}
@keyframes ui-heart{0%,100%{transform:none}12%{transform:scale(1.07)}24%{transform:none}36%{transform:scale(1.05)}}
@keyframes ui-heartv{0%,100%{opacity:.75}15%{opacity:1}30%{opacity:.8}45%{opacity:1}}
@keyframes ui-surgefull{0%,100%{filter:drop-shadow(0 0 0 rgba(255,212,90,0))}50%{filter:drop-shadow(0 0 7px rgba(255,212,90,.95))}}
@keyframes ui-avail{0%,100%{box-shadow:0 0 0 2px var(--paper),0 0 0 2px rgba(127,242,224,0)}50%{box-shadow:0 0 0 2px var(--paper),0 0 0 7px rgba(127,242,224,.35)}}
@keyframes ui-mapq{0%,100%{transform:scale(1)}50%{transform:scale(1.35)}}
@keyframes ui-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes ui-spinslow{to{transform:rotate(360deg)}}
@keyframes ui-sheen{to{transform:translateX(110%)}}
@keyframes ui-pop{0%{transform:scale(1.45)}100%{transform:scale(1)}}
@keyframes ui-comboin{from{opacity:0;transform:translateX(-14px) scale(.8)}to{opacity:1;transform:none}}
@keyframes ui-rankup{0%{transform:scale(1.8);filter:brightness(2)}60%{transform:scale(.95)}100%{transform:none;filter:none}}
@keyframes ui-burst{0%{transform:scale(.9);opacity:1}100%{transform:scale(2.4);opacity:0}}
@keyframes ui-medpop{0%,100%{transform:none}35%{transform:scale(1.18)}}
@keyframes ui-phase{0%{filter:brightness(2.4)}100%{filter:none}}
@keyframes ui-flash{0%{opacity:0}15%{opacity:1}100%{opacity:0}}
@keyframes ui-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(3px)}}
@media (prefers-reduced-motion:reduce){
  .ui-panel,.ui-pill,.ui-prompt{animation:ui-fadein 180ms ease-out}
  .ui-logo-main::after,.ui-dlgmore,.ui-badge.ui-on{animation:none}
  .ui-toast,.ui-banner,.ui-banner.ui-on,.ui-callout,.ui-callout.ui-on{transform:none}
  .ui-combo-n.ui-pop,.ui-combo.ui-in,.ui-combo.ui-rankup .ui-combo-r,.ui-med.ui-burst,.ui-med.ui-burst::after,.ui-banner-main::after{animation:none}
  .ui-fly{transition:opacity 300ms}
}
.ui-reduced .ui-panel,.ui-reduced .ui-pill,.ui-reduced .ui-prompt,.ui-reduced .ui-scr.ui-tabin .ui-panel,.ui-reduced .ui-scr.ui-tabin-r .ui-panel{animation:ui-fadein 180ms ease-out}
.ui-reduced .ui-scr.ui-closing .ui-panel{animation:none}
.ui-reduced .ui-logo-main::after,.ui-reduced .ui-dlgmore{animation:none}
.ui-reduced .ui-toast{transform:none}
.ui-reduced .ui-banner,.ui-reduced .ui-banner.ui-on,.ui-reduced .ui-callout,.ui-reduced .ui-callout.ui-on,.ui-reduced .ui-combo.ui-out{transform:none}
.ui-reduced .ui-combo-n.ui-pop,.ui-reduced .ui-combo.ui-in,.ui-reduced .ui-combo.ui-rankup .ui-combo-r,.ui-reduced .ui-med.ui-burst,.ui-reduced .ui-med.ui-burst::after,
.ui-reduced .ui-banner-main::after,.ui-reduced .ui-flashfx.ui-on{animation:none}
.ui-reduced .ui-fly{display:none}
.ui-reduced .ui-med.ui-lowhp,.ui-reduced .ui-med.ui-full,.ui-reduced .ui-hp.ui-hit{animation:none}
.ui-photo .ui-flashfx.ui-on{animation-name:ui-flashlow}
@keyframes ui-flashlow{0%{opacity:0}15%{opacity:.45}100%{opacity:0}}
`;
