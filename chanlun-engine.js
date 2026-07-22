/**
 * chanlun-engine.js — 纯 JS 缠论引擎
 * 由 AI 读《缠中说禅108课》原文后按定义自动生成
 * 流水线：K线包含处理 → 分型检测 → 笔构建 → 中枢 → 买卖点
 * 输入：bars = [{time, open, high, low, close, vol}]
 * 输出：{ fractals, bis, zss, bsps, combinedBars }
 */
(function (global) {
  'use strict';

  // ========== 1. K线包含关系处理 ==========
  // 相邻两根K线，如果一根的高低点完全包含另一根，按趋势方向合并
  function mergeKlinesWithInclusion(bars) {
    if (bars.length < 2) return bars.map(b => ({ ...b, highIdx: 0, lowIdx: 0 }));
    const merged = [{ ...bars[0], highIdx: 0, lowIdx: 0 }];
    for (let i = 1; i < bars.length; i++) {
      const cur = bars[i];
      const prev = merged[merged.length - 1];
      // 判断包含：cur 被 prev 包含，或 prev 被 cur 包含
      const curInPrev = cur.high <= prev.high && cur.low >= prev.low;
      const prevInCur = cur.high >= prev.high && cur.low <= prev.low;
      if (curInPrev || prevInCur) {
        // 看趋势方向：向前看一根
        let direction = 'up';
        if (merged.length >= 2) {
          const before = merged[merged.length - 2];
          direction = prev.high > before.high ? 'up' : (prev.low < before.low ? 'down' : 'up');
        }
        if (direction === 'up') {
          // 向上合并：取 max(high) + max(low)
          const newHigh = Math.max(prev.high, cur.high);
          const newLow = Math.max(prev.low, cur.low);
          // highIdx 追踪极值来自哪根原始K线
          const highIdx = prev.high >= cur.high ? prev.highIdx : i;
          const lowIdx = prev.low >= cur.low ? prev.lowIdx : i;
          merged[merged.length - 1] = { ...prev, high: newHigh, low: newLow, highIdx, lowIdx };
        } else {
          // 向下合并：取 min(high) + min(low)
          const newHigh = Math.min(prev.high, cur.high);
          const newLow = Math.min(prev.low, cur.low);
          const highIdx = prev.high <= cur.high ? prev.highIdx : i;
          const lowIdx = prev.low <= cur.low ? prev.lowIdx : i;
          merged[merged.length - 1] = { ...prev, high: newHigh, low: newLow, highIdx, lowIdx };
        }
      } else {
        merged.push({ ...cur, highIdx: i, lowIdx: i });
      }
    }
    return merged;
  }

  // ========== 2. 分型检测 ==========
  // 在包含处理后的K线上检测顶底分型，相邻分型不能共用K线
  function detectFractals(klines) {
    const fractals = [];
    for (let i = 1; i < klines.length - 1; i++) {
      const prev = klines[i - 1], cur = klines[i], next = klines[i + 1];
      // 顶分型
      if (cur.high > prev.high && cur.high > next.high) {
        fractals.push({ type: 'top', price: cur.high, klineIdx: i, barTime: cur.time });
      }
      // 底分型
      if (cur.low < prev.low && cur.low < next.low) {
        fractals.push({ type: 'bottom', price: cur.low, klineIdx: i, barTime: cur.time });
      }
    }
    return fractals;
  }

  // ========== 3. 笔构建（贪心zigzag） ==========
  // 相邻分型间至少间隔5根K线（min_kline_gap=4），笔严格交替上下
  function fractalsToTurningPoints(fractals, minGap) {
    minGap = minGap || 4;
    if (!fractals.length) return [];
    const points = [{ ...fractals[0] }];
    for (let i = 1; i < fractals.length; i++) {
      const f = fractals[i];
      const prev = points[points.length - 1];
      if (f.type === prev.type) {
        // 同类型：保留更极端的
        if ((f.type === 'top' && f.price > prev.price) || (f.type === 'bottom' && f.price < prev.price)) {
          points[points.length - 1] = { ...f };
        }
      } else {
        // 不同类型：检查间距
        const gap = Math.abs(f.klineIdx - prev.klineIdx) - 1;
        if (gap < minGap) continue;
        // zigzag约束：顶必须高于前底，底必须低于前顶
        if (prev.type === 'bottom' && f.price <= prev.price) continue;
        if (prev.type === 'top' && f.price >= prev.price) continue;
        points.push({ ...f });
      }
    }
    return points;
  }

  function turningPointsToBis(points, klines) {
    const bis = [];
    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1], end = points[i];
      bis.push({
        idx: i - 1,
        direction: start.type === 'bottom' ? 'up' : 'down',
        is_sure: true,
        start_time: start.barTime,
        end_time: end.barTime,
        start_value: start.price,
        end_value: end.price,
      });
    }
    return bis;
  }

  // ========== 4. 中枢检测 ==========
  // 在连续的笔中找价格重叠区间（至少3笔重叠）
  function computeZhongshu(bis) {
    const zss = [];
    if (bis.length < 3) return zss;
    let i = 0;
    while (i < bis.length - 2) {
      // 检查连续3笔是否有重叠
      const seg = bis.slice(i, i + 3);
      // 取这3笔的高低点
      let highs = [], lows = [];
      for (const b of seg) {
        highs.push(Math.max(b.start_value, b.end_value));
        lows.push(Math.min(b.start_value, b.end_value));
      }
      // ZG = 高点中的最低点，ZD = 低点中的最高点
      const ZG = Math.min(...highs);
      const ZD = Math.max(...lows);
      if (ZG > ZD) {
        // 中枢成立，尝试向前延伸
        let endIdx = i + 2;
        for (let j = i + 3; j < bis.length; j++) {
          const b = bis[j];
          const bHigh = Math.max(b.start_value, b.end_value);
          const bLow = Math.min(b.start_value, b.end_value);
          if (bLow <= ZG && bHigh >= ZD) {
            endIdx = j; // 仍与中枢重叠，延伸
          } else {
            break; // 离开中枢
          }
        }
        zss.push({
          idx: zss.length,
          is_sure: true,
          start_time: bis[i].start_time,
          end_time: bis[endIdx].end_time,
          low: ZD,
          high: ZG,
          peak_low: Math.min(...bis.slice(i, endIdx + 1).flatMap(b => [b.start_value, b.end_value])),
          peak_high: Math.max(...bis.slice(i, endIdx + 1).flatMap(b => [b.start_value, b.end_value])),
        });
        i = endIdx + 1;
      } else {
        i++;
      }
    }
    return zss;
  }

  // ========== 5. 线段（segs）检测 ==========
  // 线段 = 至少3笔同向走势。线段端点是转折点，相邻两段首尾价格必须相等（连续折线）。
  // 反转条件（缠论特征序列简化版）：
  //   上升段：出现向下笔，其终点低于"段内最近上升笔起点"（即顶分型破坏）
  //   下降段：出现向上笔，其终点高于"段内最近下降笔起点"（即底分型破坏）
  function computeSegments(bis) {
    const segs = [];
    if (bis.length < 3) return segs;
    let segStart = 0;                 // 当前段起始笔索引
    let segDir = bis[0].direction;    // 当前段方向
    let segPeakIdx = segStart;        // 段内极值笔（上升段最高 / 下降段最低）
    let lastSameDirStartIdx = segStart; // 段内最近一根同向笔的索引（用于判断分型破坏）

    for (let i = 1; i < bis.length; i++) {
      const b = bis[i];
      // 更新段内极值
      if (segDir === 'up' && b.direction === 'up') {
        if (b.end_value > bis[segPeakIdx].end_value) segPeakIdx = i;
        lastSameDirStartIdx = i;
      } else if (segDir === 'down' && b.direction === 'down') {
        if (b.end_value < bis[segPeakIdx].end_value) segPeakIdx = i;
        lastSameDirStartIdx = i;
      }
      // 方向反转检测
      if (segDir === 'up') {
        // 上升段中，向下笔终点跌破"最近一根上升笔的起点" → 顶分型破坏确认
        // （最近上升笔起点 = 段内最近的低点支撑）
        const supportValue = bis[lastSameDirStartIdx].start_value;
        if (b.direction === 'down' && lastSameDirStartIdx > segStart && b.end_value < supportValue) {
          const peakBi = bis[segPeakIdx];
          segs.push({
            idx: segs.length, direction: 'up', is_sure: true,
            start_time: bis[segStart].start_time,
            end_time: peakBi.end_time,
            start_value: bis[segStart].start_value,
            end_value: peakBi.end_value,
          });
          segStart = segPeakIdx + 1;
          segDir = 'down';
          segPeakIdx = segStart;
          lastSameDirStartIdx = segStart;
        }
      } else {
        // 下降段中，向上笔终点涨破"最近一根下降笔的起点" → 底分型破坏确认
        const resistValue = bis[lastSameDirStartIdx].start_value;
        if (b.direction === 'up' && lastSameDirStartIdx > segStart && b.end_value > resistValue) {
          const peakBi = bis[segPeakIdx];
          segs.push({
            idx: segs.length, direction: 'down', is_sure: true,
            start_time: bis[segStart].start_time,
            end_time: peakBi.end_time,
            start_value: bis[segStart].start_value,
            end_value: peakBi.end_value,
          });
          segStart = segPeakIdx + 1;
          segDir = 'up';
          segPeakIdx = segStart;
          lastSameDirStartIdx = segStart;
        }
      }
    }
    // 收尾：最后一段（未确认）
    if (segStart <= bis.length - 1) {
      let endVal, endTime;
      if (segDir === 'up') {
        let maxV = -Infinity, maxT = null;
        for (let k = segStart; k < bis.length; k++) {
          if (bis[k].end_value > maxV) { maxV = bis[k].end_value; maxT = bis[k].end_time; }
        }
        endVal = maxV; endTime = maxT;
      } else {
        let minV = Infinity, minT = null;
        for (let k = segStart; k < bis.length; k++) {
          if (bis[k].end_value < minV) { minV = bis[k].end_value; minT = bis[k].end_time; }
        }
        endVal = minV; endTime = minT;
      }
      segs.push({
        idx: segs.length, direction: segDir, is_sure: false,
        start_time: bis[segStart].start_time,
        end_time: endTime || bis[bis.length - 1].end_time,
        start_value: bis[segStart].start_value,
        end_value: endVal,
      });
    }
    return segs;
  }

  // ========== 6. 买卖点检测 ==========
  // 1买/1卖：离开中枢的第一类买卖点
  // 2买/2卖：离开后回调不破前低/前高
  // 3买/3卖：回踩中枢边沿确认
  function pushBspOnce(bsps, point) {
    const exists = bsps.some(p =>
      p.is_buy === point.is_buy &&
      p.time === point.time &&
      p.bi_idx === point.bi_idx &&
      (p.types || []).join(',') === (point.types || []).join(',')
    );
    if (!exists) bsps.push(point);
  }

  function getBreakoutParams(opts) {
    opts = opts || {};
    const symbol = String(opts.symbol || '');
    const level = String(opts.level || '');
    const isIndex = opts.type === 'index' || symbol === '000001' || /(^|[^0-9])000001$/.test(symbol);
    if (isIndex) return { mult: 2, pct: 0.003, profile: 'index' };
    if (level === '1min') return { mult: 1.5, pct: 0.006, profile: 'etf_1min' };
    return { mult: 2, pct: 0.006, profile: 'etf_default' };
  }

  // ========== 背驰检测 ==========
  // 缠论背驰：离开中枢的笔 MACD 面积 < 中枢内同向笔 MACD 面积 → 力度衰竭 → 背驰成立
  // direction='up'  → 统计红柱面积（macd>0）
  // direction='down'→ 统计绿柱面积（|macd| where macd<0）
  function buildTimeIndex(bars) {
    const idx = {};
    for (let i = 0; i < bars.length; i++) idx[bars[i].time] = i;
    return idx;
  }

  function biMacdArea(bi, bars, timeIdx) {
    const sIdx = timeIdx[bi.start_time];
    const eIdx = timeIdx[bi.end_time];
    if (sIdx == null || eIdx == null) return 0;
    let area = 0;
    const end = Math.min(eIdx, bars.length - 1);
    for (let i = sIdx; i <= end; i++) {
      const m = bars[i].macd || 0;
      if (bi.direction === 'up' && m > 0) area += m;
      else if (bi.direction === 'down' && m < 0) area += -m;
    }
    return area;
  }

  // 检测 leaveBi 相对于中枢 zs 是否背驰
  // 缠论背驰定义（正宗）：
  //   1. 价格必须创新高（向上离开）或新低（向下离开）—— 比中枢内所有同向笔的极值更极端
  //   2. MACD面积小于中枢内同向笔的最大面积 —— 力度衰竭
  //   两个条件都满足才叫背驰。只满足条件2不满足条件1 = 只是弱反弹/弱回落，不是背驰。
  // 返回 { divergence: bool, area, priorArea, priceNewExtreme: bool, reason }
  function checkDivergence(leaveBi, bis, bars, timeIdx, zs) {
    // 找中枢内部与 leaveBi 同向的所有笔
    const priorSameDir = [];
    for (const b of bis) {
      if (b.end_time < zs.start_time || b.start_time > zs.end_time) continue;
      if (b.direction !== leaveBi.direction) continue;
      if (b.start_time === leaveBi.start_time && b.end_time === leaveBi.end_time) continue;
      priorSameDir.push(b);
    }
    const leaveArea = biMacdArea(leaveBi, bars, timeIdx);
    if (!priorSameDir.length) return { divergence: false, area: leaveArea, priorArea: 0, priceNewExtreme: false, reason: 'no_prior_same_dir' };

    let maxPriorArea = 0;
    let priorPeakHigh = -Infinity, priorPeakLow = Infinity;
    for (const b of priorSameDir) {
      const a = biMacdArea(b, bars, timeIdx);
      if (a > maxPriorArea) maxPriorArea = a;
      const bHigh = Math.max(b.start_value, b.end_value);
      const bLow = Math.min(b.start_value, b.end_value);
      if (bHigh > priorPeakHigh) priorPeakHigh = bHigh;
      if (bLow < priorPeakLow) priorPeakLow = bLow;
    }

    // 离开笔的极值
    const leaveHigh = Math.max(leaveBi.start_value, leaveBi.end_value);
    const leaveLow = Math.min(leaveBi.start_value, leaveBi.end_value);

    // 条件1：价格必须创新高（向上）或新低（向下）
    let priceNewExtreme = false;
    if (leaveBi.direction === 'up') {
      priceNewExtreme = leaveHigh > priorPeakHigh;  // 突破中枢内最高点
    } else {
      priceNewExtreme = leaveLow < priorPeakLow;    // 跌破中枢内最低点
    }

    // 条件2：MACD面积小于基准
    const areaSmaller = leaveArea < maxPriorArea && maxPriorArea > 0;

    // 背驰 = 价格创新高/新低 + MACD面积萎缩
    const divergence = priceNewExtreme && areaSmaller;

    const reason = !priceNewExtreme ? 'price_not_new_extreme' : (!areaSmaller ? 'area_not_smaller' : 'divergence');
    return { divergence, area: leaveArea, priorArea: maxPriorArea, priceNewExtreme, priorPeakHigh, priorPeakLow, leaveHigh, leaveLow, reason };
  }

  // ========== 趋势检测 ==========
  // 判断中枢 zs 是否处于趋势中（缠论要求1类买卖点必须在趋势末段）。
  // 趋势定义：同方向上存在至少2个同向中枢，或该中枢的离开方向上有同向中枢。
  function isTrendZs(zs, zss, leaveSide) {
    if (!zss || zss.length < 2) return false;
    // leaveSide='up' → 上涨趋势；'down' → 下跌趋势
    // 判断1：在 zs 之前是否存在同向中枢（即该中枢前面还有一个中枢，且离开方向与 leaveSide 一致）
    for (const z of zss) {
      if (z === zs || z.end_time >= zs.start_time) continue;
      // 前序中枢若与当前中枢大致同方向（都偏高/都偏低），算同向趋势
      const zMid = (z.low + z.high) / 2, curMid = (zs.low + zs.high) / 2;
      if (leaveSide === 'up' && zMid < curMid) return true;
      if (leaveSide === 'down' && zMid > curMid) return true;
    }
    // 判断2：中枢之后还存在同向中枢
    for (const z of zss) {
      if (z === zs || z.start_time <= zs.end_time) continue;
      const zMid = (z.low + z.high) / 2, curMid = (zs.low + zs.high) / 2;
      if (leaveSide === 'up' && zMid > curMid) return true;
      if (leaveSide === 'down' && zMid < curMid) return true;
    }
    return false;
  }

  // ========== 买卖点评级 ==========
  // chanlun_level: 'strict' | 'partial' | 'weak'
  //   strict  = 严格符合缠论定义（趋势+背驰的1类 / 依附1类的2类 / 独立的3类）
  //   partial = 部分符合（非背驰1类 / 非趋势中枢1类）— 仍展示但视觉弱化
  //   weak    = 预警/疑似（1p 疑似买卖点）— 不上主图、不推送
  // 评级规则严格遵循缠论正宗定义，便于一眼区分信号强度。
  function classifyBspPoint(point, zs, zss, leaveSide) {
    const types = point.types || [];

    // 1p 疑似买卖点 → weak（非缠论概念，纯实时预警）
    if (types.includes('1p')) {
      point.chanlun_level = 'weak';
      point.level_label = '疑似';
      point.status = 'watch';
      point.strength = '中枢内突破预警';
      point.signal_reason = point.reason || 'inside_breakout';
      point.show_on_chart = false;
      point.notify = false;
      return point;
    }

    // 3类买卖点：独立于1/2类，不需要趋势和背驰，回踩不回中枢即为 strict
    if (types.includes('3')) {
      point.chanlun_level = 'strict';
      point.level_label = '确认';
      point.status = 'confirmed';
      point.strength = point.is_buy ? '回踩不回中枢' : '反抽不回中枢';
      point.signal_reason = point.is_buy ? 'third_buy_confirm' : 'third_sell_confirm';
      point.show_on_chart = true;
      point.notify = true;
      return point;
    }

    // 1类买卖点：趋势 + 背驰 → strict；否则 partial
    if (types.includes('1')) {
      const hasTrend = zs ? isTrendZs(zs, zss, leaveSide) : false;
      const hasDiv = point.divergence === true;
      if (hasTrend && hasDiv) {
        point.chanlun_level = 'strict';
        point.level_label = '确认';
        point.status = 'strong';
        point.strength = '趋势背驰';
        point.signal_reason = 'trend_divergence';
        point.show_on_chart = true;
        point.notify = true;
      } else if (hasDiv) {
        // 有背驰但非趋势（盘整背驰）→ partial
        point.chanlun_level = 'partial';
        point.level_label = '参考';
        point.status = 'confirmed';
        point.strength = '盘整背驰';
        point.signal_reason = 'range_divergence';
        point.show_on_chart = true;
        point.notify = false;
      } else if (hasTrend) {
        // 是趋势但没背驰 → partial
        point.chanlun_level = 'partial';
        point.level_label = '参考';
        point.status = 'confirmed';
        point.strength = '趋势离开';
        point.signal_reason = 'trend_no_divergence';
        point.show_on_chart = true;
        point.notify = false;
      } else {
        // 既非趋势也无背驰 → partial（最弱的有效信号）
        point.chanlun_level = 'partial';
        point.level_label = '参考';
        point.status = 'watch';
        point.strength = '中枢离开';
        point.signal_reason = 'zs_leave_no_trend_no_div';
        point.show_on_chart = true;
        point.notify = false;
      }
      return point;
    }

    // 2类买卖点：依附1类，前一阶段必须有1类才 → strict；否则 partial
    if (types.includes('2')) {
      // 2类本身定义成立（回调不破前极值），等级取决于前置1类的强度
      if (point.parent_divergence === true) {
        point.chanlun_level = 'strict';
        point.level_label = '确认';
        point.status = 'confirmed';
        point.strength = '回抽确认';
        point.signal_reason = 'pullback_after_strong1';
        point.show_on_chart = true;
        point.notify = true;
      } else {
        // 前置1类非背驰或缺失 → partial
        point.chanlun_level = 'partial';
        point.level_label = '参考';
        point.status = 'watch';
        point.strength = '回抽观察';
        point.signal_reason = 'pullback_after_weak1';
        point.show_on_chart = true;
        point.notify = false;
      }
      return point;
    }

    // 其他兜底
    point.chanlun_level = 'weak';
    point.level_label = '观察';
    point.status = point.is_confirmed ? 'confirmed' : 'watch';
    point.strength = point.is_confirmed ? '确认' : '观察';
    point.signal_reason = point.reason || 'unknown';
    point.show_on_chart = point.is_confirmed === true;
    point.notify = false;
    return point;
  }

  function addThirdClassPoints(bsps, bis, afterBis, zs) {
    let upBreak = null;
    let downBreak = null;
    for (const b of afterBis) {
      const idx = bis.indexOf(b);
      if (idx < 0) continue;
      const bHigh = Math.max(b.start_value, b.end_value);
      const bLow = Math.min(b.start_value, b.end_value);

      if (upBreak && b.direction === 'down') {
        const buy3Value = Math.min(b.start_value, b.end_value);
        const buy3Time = b.end_value <= b.start_value ? b.end_time : b.start_time;
        if (buy3Value > zs.high && buy3Value < upBreak.value) {
          pushBspOnce(bsps, {
            is_buy: true, types: ['3'], time: buy3Time, value: buy3Value,
            bi_idx: idx, is_confirmed: true, parent_zs_idx: zs.idx
          });
          upBreak = null;
        } else if (buy3Value <= zs.high) {
          upBreak = null;
        }
      }

      if (downBreak && b.direction === 'up') {
        const sell3Value = Math.max(b.start_value, b.end_value);
        const sell3Time = b.end_value >= b.start_value ? b.end_time : b.start_time;
        if (sell3Value < zs.low && sell3Value > downBreak.value) {
          pushBspOnce(bsps, {
            is_buy: false, types: ['3'], time: sell3Time, value: sell3Value,
            bi_idx: idx, is_confirmed: true, parent_zs_idx: zs.idx
          });
          downBreak = null;
        } else if (sell3Value >= zs.low) {
          downBreak = null;
        }
      }

      if (bHigh > zs.high) {
        upBreak = { value: bHigh, idx };
      }
      if (bLow < zs.low) {
        downBreak = { value: bLow, idx };
      }
    }
  }

  function timeKey(t) { return String(t || ''); }

  // 每个中枢每类每方向最多保留首个（避免一个中枢标 3 个同向信号）
  function deduplicateBsps(bsps) {
    const seen = new Set();
    return bsps.filter(b => {
      // 1p 不去重（预警性质，保留每个）
      if ((b.types || []).includes('1p')) return true;
      const key = (b.parent_zs_idx == null ? 'na' : b.parent_zs_idx) + ':' +
                  (b.types || []).join(',') + ':' + (b.is_buy ? 'buy' : 'sell');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function computeBuySellPoints(bis, zss, opts, bars) {
    const bsps = [];
    if (!zss.length || !bis.length) return bsps;
    const timeIdx = bars ? buildTimeIndex(bars) : null;
    for (const zs of zss) {
      const zsHeight = Math.max(zs.high - zs.low, 0.000001);
      const params = getBreakoutParams(opts);
      const breakoutLimit = Math.max(zsHeight * params.mult, zs.high * params.pct);

      // A bi that starts inside the pivot and breaks far beyond it is an early warning.
      // It is useful for realtime dashboards, but is not a confirmed Chanlun sell/buy point yet.
      for (let i = 0; i < bis.length; i++) {
        const b = bis[i];
        if (b.end_time < zs.start_time || b.end_time > zs.end_time) continue;
        const bHigh = Math.max(b.start_value, b.end_value);
        const bLow = Math.min(b.start_value, b.end_value);
        const startInside = b.start_value >= zs.low && b.start_value <= zs.high;
        if (startInside && b.direction === 'up' && bHigh > zs.high && (bHigh - zs.high) >= breakoutLimit) {
          const div = (timeIdx && bars) ? checkDivergence(b, bis, bars, timeIdx, zs) : null;
          pushBspOnce(bsps, {
            is_buy: false, types: ['1p'], time: b.end_time, value: b.end_value, bi_idx: i, parent_zs_idx: zs.idx,
            is_confirmed: false, reason: 'inside_up_breakout',
            divergence: div ? div.divergence : undefined,
            macd_area: div ? div.area : undefined, prior_area: div ? div.priorArea : undefined
          });
        }
        if (startInside && b.direction === 'down' && bLow < zs.low && (zs.low - bLow) >= breakoutLimit) {
          const div = (timeIdx && bars) ? checkDivergence(b, bis, bars, timeIdx, zs) : null;
          pushBspOnce(bsps, {
            is_buy: true, types: ['1p'], time: b.end_time, value: b.end_value, bi_idx: i, parent_zs_idx: zs.idx,
            is_confirmed: false, reason: 'inside_down_breakout',
            divergence: div ? div.divergence : undefined,
            macd_area: div ? div.area : undefined, prior_area: div ? div.priorArea : undefined
          });
        }
      }

      const afterBis = bis.filter(b => b.start_time >= zs.end_time);
      if (!afterBis.length) continue;
      addThirdClassPoints(bsps, bis, afterBis, zs);

      let leaveBi = null;
      let leaveSide = null;
      for (const b of afterBis) {
        const bHigh = Math.max(b.start_value, b.end_value);
        const bLow = Math.min(b.start_value, b.end_value);
        if (bLow > zs.high) { leaveBi = b; leaveSide = 'up'; break; }
        if (bHigh < zs.low) { leaveBi = b; leaveSide = 'down'; break; }
      }
      if (!leaveBi) continue;

      const leaveIdx = bis.indexOf(leaveBi);
      const div = (timeIdx && bars) ? checkDivergence(leaveBi, bis, bars, timeIdx, zs) : null;
      if (leaveSide === 'up') {
        // 向上离开中枢 → 卖点。极值高点可能出现在笔起点或终点
        const isEndHigh = leaveBi.end_value >= leaveBi.start_value;
        const sellValue = Math.max(leaveBi.start_value, leaveBi.end_value);
        const sellTime = isEndHigh ? leaveBi.end_time : leaveBi.start_time;
        pushBspOnce(bsps, {
          is_buy: false, types: ['1'], time: sellTime, value: sellValue,
          bi_idx: leaveIdx, is_confirmed: true, parent_zs_idx: zs.idx,
          _zs: zs, _leaveSide: leaveSide,
          divergence: div ? div.divergence : undefined,
          macd_area: div ? div.area : undefined, prior_area: div ? div.priorArea : undefined
        });
        for (let k = leaveIdx + 1; k < Math.min(bis.length, leaveIdx + 6); k++) {
          const b2 = bis[k];
          // 2卖应锚定后续反抽高点，也就是顶分型。
          if (b2.direction !== 'up') continue;
          const sell2Value = Math.max(b2.start_value, b2.end_value);
          const sell2Time = b2.end_value >= b2.start_value ? b2.end_time : b2.start_time;
          if (sell2Value < sellValue && sell2Value > zs.high) {
            pushBspOnce(bsps, {
              is_buy: false, types: ['2'], time: sell2Time, value: sell2Value,
              bi_idx: k, is_confirmed: div ? div.divergence === true : false,
              parent_zs_idx: zs.idx, _zs: zs, _leaveSide: leaveSide,
              parent_divergence: div ? div.divergence : undefined,
              parent_status: div && div.divergence === true ? 'strong' : 'watch'
            });
            break;
          }
        }
        for (let k = leaveIdx + 1; k < Math.min(bis.length, leaveIdx + 8); k++) {
          const b3 = bis[k];
          // 3买：向上离开中枢后，后续向下回踩低点不回到中枢上沿。
          if (b3.direction !== 'down') continue;
          const buy3Value = Math.min(b3.start_value, b3.end_value);
          const buy3Time = b3.end_value <= b3.start_value ? b3.end_time : b3.start_time;
          if (buy3Value > zs.high && buy3Value < sellValue) {
            pushBspOnce(bsps, {
              is_buy: true, types: ['3'], time: buy3Time, value: buy3Value,
              bi_idx: k, is_confirmed: true, parent_zs_idx: zs.idx, _zs: zs, _leaveSide: 'up'
            });
            break;
          }
        }
      } else {
        // 向下离开中枢 → 买点。极值低点可能出现在笔起点或终点
        const isEndLow = leaveBi.end_value <= leaveBi.start_value;
        const buyValue = Math.min(leaveBi.start_value, leaveBi.end_value);
        const buyTime = isEndLow ? leaveBi.end_time : leaveBi.start_time;
        pushBspOnce(bsps, {
          is_buy: true, types: ['1'], time: buyTime, value: buyValue,
          bi_idx: leaveIdx, is_confirmed: true, parent_zs_idx: zs.idx,
          _zs: zs, _leaveSide: leaveSide,
          divergence: div ? div.divergence : undefined,
          macd_area: div ? div.area : undefined, prior_area: div ? div.priorArea : undefined
        });
        for (let k = leaveIdx + 1; k < Math.min(bis.length, leaveIdx + 6); k++) {
          const b2 = bis[k];
          // 2买应锚定后续回调低点，也就是底分型。
          if (b2.direction !== 'down') continue;
          const buy2Value = Math.min(b2.start_value, b2.end_value);
          const buy2Time = b2.end_value <= b2.start_value ? b2.end_time : b2.start_time;
          if (buy2Value > buyValue && buy2Value < zs.low) {
            pushBspOnce(bsps, {
              is_buy: true, types: ['2'], time: buy2Time, value: buy2Value,
              bi_idx: k, is_confirmed: div ? div.divergence === true : false,
              parent_zs_idx: zs.idx, _zs: zs, _leaveSide: leaveSide,
              parent_divergence: div ? div.divergence : undefined,
              parent_status: div && div.divergence === true ? 'strong' : 'watch'
            });
            break;
          }
        }
        for (let k = leaveIdx + 1; k < Math.min(bis.length, leaveIdx + 8); k++) {
          const b3 = bis[k];
          // 3卖：向下离开中枢后，后续向上反抽高点不回到中枢下沿。
          if (b3.direction !== 'up') continue;
          const sell3Value = Math.max(b3.start_value, b3.end_value);
          const sell3Time = b3.end_value >= b3.start_value ? b3.end_time : b3.start_time;
          if (sell3Value < zs.low && sell3Value > buyValue) {
            pushBspOnce(bsps, {
              is_buy: false, types: ['3'], time: sell3Time, value: sell3Value,
              bi_idx: k, is_confirmed: true, parent_zs_idx: zs.idx, _zs: zs, _leaveSide: 'down'
            });
            break;
          }
        }
      }
    }
    return bsps;
  }

  // ========== 6. MACD 计算（12/26/9） ==========
  function computeMACD(bars) {
    if (bars.length < 30) {
      for (const b of bars) { b.dif = 0; b.dea = 0; b.macd = 0; }
      return;
    }
    const SHORT = 12, LONG = 26, MID = 9;
    let emaShort = bars[0].close, emaLong = bars[0].close, dea = 0;
    const ms = 2 / (SHORT + 1), ml = 2 / (LONG + 1), md = 2 / (MID + 1);
    for (let i = 0; i < bars.length; i++) {
      const c = bars[i].close;
      emaShort = i === 0 ? c : c * ms + emaShort * (1 - ms);
      emaLong = i === 0 ? c : c * ml + emaLong * (1 - ml);
      const dif = emaShort - emaLong;
      dea = i === 0 ? dif : dif * md + dea * (1 - md);
      bars[i].dif = dif;
      bars[i].dea = dea;
      bars[i].macd = (dif - dea) * 2;
    }
  }

  // ========== 主入口：完整流水线 ==========
  // 输出格式与看板 DATA.levels[lv].chan 完全对齐
  function compute(bars, opts) {
    if (!bars || bars.length < 10) {
      return {
        fractals: [], bis: [], segs: [], zss: [], bsps: [], combinedBars: bars || [],
        fx_count: 0, bi_count: 0, seg_count: 0, zs_count: 0, bsp_count: 0, combined_kline_count: bars ? bars.length : 0,
      };
    }
    // 1. MACD（直接在 bars 上原地写入 dif/dea/macd）
    computeMACD(bars);
    // 2. K线包含处理
    const combined = mergeKlinesWithInclusion(bars);
    // 3. 分型检测
    const fractals = detectFractals(combined);
    // 4. 笔构建
    const points = fractalsToTurningPoints(fractals, 4);
    const bis = turningPointsToBis(points, combined);
    // 5. 线段
    const segs = computeSegments(bis);
    // 6. 中枢
    const zss = computeZhongshu(bis);
    // 7. 买卖点（传入 bars 用于背驰检测）
    const bsps = computeBuySellPoints(bis, zss, opts, bars);
    // 每中枢每类每方向只保留首个（去重）
    const deduped = deduplicateBsps(bsps);
    // 评级：每个买卖点根据缠论符合度分 strict/partial/weak
    for (const b of deduped) {
      classifyBspPoint(b, b._zs, zss, b._leaveSide);
      delete b._zs; delete b._leaveSide; // 清理临时引用，避免 JSON 序列化循环
    }
    // 生成中文 type_label
    for (const b of deduped) {
      const typeMap = { '1': '1类', '2': '2类', '3': '3类', '1p': '疑似1类' };
      const labels = b.types.map(t => typeMap[t] || t);
      let label = (b.is_buy ? '买' : '卖') + labels.join('/');
      if (b.strength) label += '·' + b.strength;
      b.type_label = label;
    }
    return {
      fractals, bis, segs, zss, bsps: deduped, combinedBars: combined,
      fx_count: fractals.length,
      bi_count: bis.length,
      seg_count: segs.length,
      zs_count: zss.length,
      bsp_count: bsps.length,
      combined_kline_count: combined.length,
    };
  }

  /**
   * 便捷方法：把引擎输出包装成看板 DATA.levels[lv].chan 期望的结构。
   * 调用：ChanlunEngine.computeForDashboard(bars) → { chan: {...}, bars }
   * bars 原地更新了 dif/dea/macd 字段
   */
  function computeForDashboard(bars, opts) {
    const r = compute(bars, opts);
    return {
      bars: bars,
      chan: {
        bis: r.bis,
        segs: r.segs,
        zss: r.zss,
        bsps: r.bsps,
        fractals: r.fractals,
        bi_count: r.bi_count,
        seg_count: r.seg_count,
        zs_count: r.zs_count,
        bsp_count: r.bsp_count,
        fx_count: r.fx_count,
        combined_kline_count: r.combined_kline_count,
      },
    };
  }

  global.ChanlunEngine = {
    compute, computeForDashboard,
    mergeKlinesWithInclusion, detectFractals, computeMACD,
    computeSegments, computeZhongshu, computeBuySellPoints, getBreakoutParams,
  };
})(typeof window !== 'undefined' ? window : this);
