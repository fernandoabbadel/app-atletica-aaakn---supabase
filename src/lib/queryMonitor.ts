/**
 * Query Performance Monitoring
 * 
 * Track all API queries for egress analysis.
 * Used to populate admin dashboard showing consumption metrics.
 * 
 * Usage:
 * ```typescript
 * // In API route
 * const start = Date.now();
 * const data = await fetchData();
 * QueryMonitor.recordQuery({
 *   endpoint: '/api/public/landing',
 *   method: 'GET',
 *   durationMs: Date.now() - start,
 *   payloadBytes: JSON.stringify(data).length,
 *   cacheHit: true,
 *   tenantId: 'public',
 * });
 * ```
 */

export interface QueryMetric {
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  timestamp: Date;
  durationMs: number;
  payloadBytes: number;
  cacheHit: boolean;
  statusCode?: number;
  error?: string;
  tenantId?: string;
}

interface AggregatedMetrics {
  totalRequests: number;
  totalBytes: number;
  avgDurationMs: number;
  avgPayloadBytes: number;
  cacheHitRate: number;
  errorCount: number;
  topEndpoints: Array<{ endpoint: string; count: number; totalBytes: number; avgDurationMs: number }>;
  byMethod: Record<string, number>;
  byTenant: Record<string, { count: number; bytes: number }>;
}

export class QueryMonitor {
  private static metrics: QueryMetric[] = [];
  private static readonly MAX_METRICS = 5000;
  private static readonly RETENTION_HOURS = 24;

  /**
   * Record a query/API call
   */
  static recordQuery(metric: Omit<QueryMetric, 'timestamp'>) {
    const entry: QueryMetric = {
      ...metric,
      timestamp: new Date(),
    };

    QueryMonitor.metrics.push(entry);

    // Keep only last N entries and within retention window
    if (QueryMonitor.metrics.length > QueryMonitor.MAX_METRICS) {
      QueryMonitor.metrics = QueryMonitor.metrics.slice(-QueryMonitor.MAX_METRICS);
    }

    QueryMonitor.cleanup();
  }

  /**
   * Get aggregated metrics for a time window
   */
  static getMetrics(minutesBack: number = 60): AggregatedMetrics {
    const cutoff = Date.now() - minutesBack * 60 * 1000;
    const filtered = QueryMonitor.metrics.filter(m => m.timestamp.getTime() > cutoff);

    if (filtered.length === 0) {
      return {
        totalRequests: 0,
        totalBytes: 0,
        avgDurationMs: 0,
        avgPayloadBytes: 0,
        cacheHitRate: 0,
        errorCount: 0,
        topEndpoints: [],
        byMethod: {},
        byTenant: {},
      };
    }

    // Aggregate by endpoint
    const byEndpoint = new Map<string, QueryMetric[]>();
    filtered.forEach(m => {
      if (!byEndpoint.has(m.endpoint)) {
        byEndpoint.set(m.endpoint, []);
      }
      byEndpoint.get(m.endpoint)!.push(m);
    });

    const topEndpoints = Array.from(byEndpoint.entries())
      .map(([endpoint, metrics]) => ({
        endpoint,
        count: metrics.length,
        totalBytes: metrics.reduce((sum, m) => sum + m.payloadBytes, 0),
        avgDurationMs: metrics.reduce((sum, m) => sum + m.durationMs, 0) / metrics.length,
      }))
      .sort((a, b) => b.totalBytes - a.totalBytes)
      .slice(0, 20);

    // Aggregate by method
    const byMethod: Record<string, number> = {};
    filtered.forEach(m => {
      byMethod[m.method] = (byMethod[m.method] || 0) + 1;
    });

    // Aggregate by tenant
    const byTenant: Record<string, { count: number; bytes: number }> = {};
    filtered.forEach(m => {
      const tenant = m.tenantId || 'unknown';
      if (!byTenant[tenant]) {
        byTenant[tenant] = { count: 0, bytes: 0 };
      }
      byTenant[tenant].count++;
      byTenant[tenant].bytes += m.payloadBytes;
    });

    const totalBytes = filtered.reduce((sum, m) => sum + m.payloadBytes, 0);
    const cacheHits = filtered.filter(m => m.cacheHit).length;
    const errors = filtered.filter(m => m.error || m.statusCode === 500 || m.statusCode === 400).length;

    return {
      totalRequests: filtered.length,
      totalBytes,
      avgDurationMs: filtered.reduce((sum, m) => sum + m.durationMs, 0) / filtered.length,
      avgPayloadBytes: totalBytes / filtered.length,
      cacheHitRate: cacheHits / filtered.length,
      errorCount: errors,
      topEndpoints,
      byMethod,
      byTenant,
    };
  }

  /**
   * Get projected daily/monthly egress
   */
  static getProjection() {
    const metrics60 = QueryMonitor.getMetrics(60);

    // If we have 24h data, use that; otherwise extrapolate
    const dataWindow = QueryMonitor.metrics.length > 0 
      ? (Date.now() - QueryMonitor.metrics[0].timestamp.getTime()) / 1000 / 60
      : 60;

    const avgBytesPerMin = metrics60.totalBytes / Math.max(60, dataWindow);
    const projectedDaily = avgBytesPerMin * 60 * 24;
    const projectedMonthly = projectedDaily * 30;

    return {
      dailyBytes: Math.round(projectedDaily),
      dailyGb: (projectedDaily / 1024 / 1024 / 1024).toFixed(2),
      monthlyBytes: Math.round(projectedMonthly),
      monthlyGb: (projectedMonthly / 1024 / 1024 / 1024).toFixed(2),
      safeGb: 1,
      status: parseFloat((projectedMonthly / 1024 / 1024 / 1024).toFixed(2)) > 1 ? '🔴 OVER' : '✅ SAFE',
    };
  }

  /**
   * Get recommendations based on metrics
   */
  static getRecommendations(): string[] {
    const metrics = QueryMonitor.getMetrics(1440); // Last 24h
    const recommendations: string[] = [];

    // Check cache hit rate
    if (metrics.cacheHitRate < 0.5) {
      recommendations.push('Cache hit rate < 50%. Consider increasing cache TTL or adding more cache keys.');
    } else if (metrics.cacheHitRate < 0.7) {
      recommendations.push('Cache hit rate < 70%. Potential for improvement.");');
    } else if (metrics.cacheHitRate >= 0.85) {
      recommendations.push('✅ Cache hit rate is excellent (>85%). Maintain current settings.');
    }

    // Check top endpoint
    if (metrics.topEndpoints.length > 0) {
      const topEnd = metrics.topEndpoints[0];
      const percent = (topEnd.totalBytes / metrics.totalBytes) * 100;

      if (percent > 50) {
        recommendations.push(
          `Endpoint "${topEnd.endpoint}" accounts for ${percent.toFixed(1)}% of egress. ` +
          `Consider optimizing this endpoint's payload size or cache strategy.`
        );
      }
    }

    // Check error rate
    const errorRate = metrics.errorCount / metrics.totalRequests;
    if (errorRate > 0.05) {
      recommendations.push(`Error rate is ${(errorRate * 100).toFixed(1)}%. Investigate failing requests.`);
    }

    // Check slow queries
    const slowQueries = QueryMonitor.metrics.filter(m => m.durationMs > 5000);
    if (slowQueries.length > metrics.totalRequests * 0.1) {
      recommendations.push('> 10% of queries take > 5s. Consider adding database indexes or optimizing queries.');
    }

    // Egress warning
    const projection = QueryMonitor.getProjection();
    if (parseFloat(projection.monthlyGb) > 0.8) {
      recommendations.push(
        `⚠️ Projected monthly egress: ${projection.monthlyGb}GB (Limit: 1GB). ` +
        `Implement aggressive caching or consider CDN.`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ All metrics look good! No immediate optimizations needed.');
    }

    return recommendations;
  }

  /**
   * Clear metrics older than retention window
   */
  private static cleanup() {
    const cutoff = Date.now() - QueryMonitor.RETENTION_HOURS * 60 * 60 * 1000;
    QueryMonitor.metrics = QueryMonitor.metrics.filter(m => m.timestamp.getTime() > cutoff);
  }

  /**
   * Get all metrics (for testing/debugging)
   */
  static getAllMetrics(): QueryMetric[] {
    return [...QueryMonitor.metrics];
  }

  /**
   * Clear all metrics
   */
  static clear() {
    QueryMonitor.metrics = [];
  }

  /**
   * Export metrics as CSV for analysis
   */
  static exportCsv(): string {
    const header = 'timestamp,endpoint,method,durationMs,payloadBytes,cacheHit,statusCode,tenantId\n';
    const rows = QueryMonitor.metrics
      .map(
        m =>
          `${m.timestamp.toISOString()},${m.endpoint},${m.method},${m.durationMs},${m.payloadBytes},${m.cacheHit},${m.statusCode || 'N/A'},${m.tenantId || 'unknown'}`
      )
      .join('\n');

    return header + rows;
  }
}

export default QueryMonitor;

/**
 * Helper to format bytes for display
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
