/**
 * Import engine — orchestrates bulk import of OpenClaw sessions into Lucid.
 *
 * Handles discovery, filtering, confirmation, and episode creation.
 * NEVER auto-extracts memories — only saves episodes.
 */

import { createInterface } from 'node:readline';
import { saveEpisode, episodeExistsBySourceSessionId } from '../core/episodes';
import {
  discoverSessions,
  parseSession,
  sessionToTranscript,
  generateSessionSummary,
  generateSessionLabel,
  getDefaultOpenClawDir,
} from './openclaw';
import type { Config } from '../storage/schema';
import type { DiscoveredSession } from './openclaw';

// ─── Types ───────────────────────────────────────────────────────────

export interface ImportOptions {
  openclawDir?: string;
  agents?: string[];
  channels?: string[];
  since?: string;
  dryRun?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

export interface ImportResult {
  sessionsScanned: number;
  sessionsImported: number;
  sessionsSkipped: number;
  sessionsAlreadyImported: number;
  episodesCreated: number;
  errors: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Ask for user confirmation via stdin.
 */
async function askConfirmation(message: string): Promise<boolean> {
  // If stdin is not a TTY, don't prompt
  if (!process.stdin.isTTY) {
    return false;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}

/**
 * Filter discovered sessions by options.
 */
function filterSessions(sessions: DiscoveredSession[], options: ImportOptions): DiscoveredSession[] {
  let filtered = sessions;

  if (options.agents && options.agents.length > 0) {
    const agents = options.agents.map((a) => a.toLowerCase());
    filtered = filtered.filter((s) => agents.includes(s.agentId.toLowerCase()));
  }

  if (options.channels && options.channels.length > 0) {
    const channels = options.channels.map((c) => c.toLowerCase().replace(/^#/, ''));
    filtered = filtered.filter((s) =>
      s.channels.some((c) => channels.includes(c.toLowerCase())),
    );
  }

  if (options.since) {
    const sinceDate = new Date(options.since);
    if (!isNaN(sinceDate.getTime())) {
      filtered = filtered.filter((s) => {
        if (!s.timestamp) return true; // Include sessions without timestamps
        const sessionDate = new Date(s.timestamp);
        return !isNaN(sessionDate.getTime()) && sessionDate >= sinceDate;
      });
    }
  }

  return filtered;
}

/**
 * Format bytes to human-readable size.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ─── Main Import Function ────────────────────────────────────────────

/**
 * Import OpenClaw sessions into Lucid as episodes.
 */
export async function importOpenClaw(config: Config, options: ImportOptions): Promise<ImportResult> {
  const result: ImportResult = {
    sessionsScanned: 0,
    sessionsImported: 0,
    sessionsSkipped: 0,
    sessionsAlreadyImported: 0,
    episodesCreated: 0,
    errors: [],
  };

  // 1. Discover sessions
  const openclawDir = options.openclawDir ?? getDefaultOpenClawDir();
  console.error('Scanning OpenClaw sessions...\n');

  const allSessions = await discoverSessions(openclawDir);
  if (allSessions.length === 0) {
    console.error('No OpenClaw sessions found.');
    console.error(`Checked: ${openclawDir}/agents/*/sessions/*.jsonl`);
    return result;
  }

  // 2. Apply filters
  const sessions = filterSessions(allSessions, options);
  result.sessionsScanned = sessions.length;

  if (sessions.length === 0) {
    console.error('No sessions match your filters.');
    return result;
  }

  // 3. Show summary
  const agentGroups = new Map<string, DiscoveredSession[]>();
  for (const s of sessions) {
    const existing = agentGroups.get(s.agentId) ?? [];
    existing.push(s);
    agentGroups.set(s.agentId, existing);
  }

  console.error(`Found ${sessions.length} sessions across ${agentGroups.size} agents:\n`);
  for (const [agent, agentSessions] of agentGroups) {
    const allChannels = new Set<string>();
    for (const s of agentSessions) {
      for (const c of s.channels) allChannels.add(c);
    }
    const channelList = allChannels.size > 0
      ? Array.from(allChannels).map((c) => `#${c}`).join(', ')
      : '(no channel detected)';
    console.error(`  ${agent.padEnd(12)} ${String(agentSessions.length).padStart(3)} sessions  ${channelList}`);
  }

  console.error('\n⚠️  Security: Tool output and credentials will be excluded. Data stays local.\n');

  // 4. Dry run — just show what would be imported
  if (options.dryRun) {
    console.error(`Would import ${sessions.length} sessions:\n`);
    for (const s of sessions) {
      const dateStr = s.timestamp
        ? new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : 'Unknown';
      const channelList = s.channels.length > 0 ? `#${s.channels.join(', #')}` : '(unknown)';
      console.error(`  [${dateStr}] ${channelList} — ${s.messageCount} messages, ${formatBytes(s.sizeBytes)}`);
    }
    console.error('\nNo changes made (dry run).');
    return result;
  }

  // 5. Confirmation prompt
  if (!options.yes) {
    const confirmed = await askConfirmation(`Import all ${sessions.length} sessions? [y/n]: `);
    if (!confirmed) {
      console.error('\nImport cancelled.');
      return result;
    }
  }

  // 6. Import each session
  console.error('\nImporting...');

  for (const discovered of sessions) {
    try {
      // Check for duplicates
      if (episodeExistsBySourceSessionId(discovered.sessionId, config)) {
        const label = discovered.channels.length > 0 ? `#${discovered.channels[0]}` : discovered.agentId;
        if (options.verbose) {
          console.error(`  ⏭ Already imported: ${label} session (${discovered.sessionId.slice(0, 8)})`);
        }
        result.sessionsAlreadyImported++;
        result.sessionsSkipped++;
        continue;
      }

      // Parse the session
      const parsed = await parseSession(discovered.filePath);

      // Skip sessions with too few messages
      if (parsed.messages.length < 3) {
        if (options.verbose) {
          console.error(`  ⏭ ${parsed.channel !== 'unknown' ? `#${parsed.channel}` : discovered.agentId} session — skipped (< 3 messages)`);
        }
        result.sessionsSkipped++;
        continue;
      }

      // Generate transcript, summary, label
      const transcript = sessionToTranscript(parsed);
      const summary = generateSessionSummary(parsed);
      const label = generateSessionLabel(parsed);

      // Determine tags
      const tags: string[] = [];
      if (parsed.channel !== 'unknown') tags.push(parsed.channel);
      tags.push(`agent:${parsed.agentId}`);
      tags.push('imported');

      // Save as episode
      await saveEpisode({
        transcript,
        label,
        summary,
        tags,
        duration: parsed.duration,
        sourceSessionId: discovered.sessionId,
      }, config);

      result.sessionsImported++;
      result.episodesCreated++;

      if (options.verbose) {
        console.error(`  ✓ ${label} — ${parsed.messages.length} messages, ${parsed.duration || 'unknown duration'}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${discovered.filePath}: ${message}`);
      if (options.verbose) {
        console.error(`  ✗ ${discovered.filePath}: ${message}`);
      }
    }
  }

  // 7. Print summary
  console.error(`\n✅ Import complete`);
  console.error(`   Sessions scanned: ${result.sessionsScanned}`);
  console.error(`   Episodes created: ${result.episodesCreated}`);
  if (result.sessionsAlreadyImported > 0) {
    console.error(`   Already imported: ${result.sessionsAlreadyImported}`);
  }
  if (result.sessionsSkipped > 0) {
    console.error(`   Skipped: ${result.sessionsSkipped - result.sessionsAlreadyImported} (too few messages)`);
  }
  if (result.errors.length > 0) {
    console.error(`   Errors: ${result.errors.length}`);
  }
  console.error(`\nRun 'lucid session search "query"' to search across all imported conversations.`);

  return result;
}
