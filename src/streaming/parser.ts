import type { ContentBlock, Citation, Step } from '../types';

// Event callbacks for stream processing
export interface StreamCallbacks {
  onMessageStart?: (uuid: string) => void;
  onTextDelta?: (text: string, fullText: string, blockIndex: number) => void;
  onThinkingStart?: (blockIndex: number) => void;
  onThinkingDelta?: (thinking: string, blockIndex: number) => void;
  onThinkingStop?: (thinkingText: string, summaries: Array<{ summary: string } | string>, blockIndex: number) => void;
  onToolStart?: (toolName: string, message: string, blockIndex: number) => void;
  onToolStop?: (toolName: string, input: string, blockIndex: number) => void;
  onToolResult?: (toolName: string, result: unknown, isError: boolean, blockIndex: number) => void;
  onCitation?: (citation: Citation, blockIndex: number) => void;
  onToolApproval?: (toolName: string, approvalKey: string, input: unknown) => void;
  onCompaction?: (status: string, message?: string) => void;
  onComplete?: (fullText: string, steps: Step[], messageUuid: string) => void;
}

// Stream parser state
export interface StreamState {
  fullResponse: string;
  lastMessageUuid: string;
  contentBlocks: Map<number, ContentBlock>;
  pendingCitations: Map<string, Citation>;
}

// Create initial state for a new stream
export function createStreamState(): StreamState {
  return {
    fullResponse: '',
    lastMessageUuid: '',
    contentBlocks: new Map(),
    pendingCitations: new Map()
  };
}

// Parse display_content from tool_result
function parseDisplayContent(displayContent: unknown): unknown {
  if (!displayContent) return null;

  const dc = displayContent as Record<string, unknown>;

  if (dc.type === 'rich_link' && dc.link) {
    return { type: 'rich_link', link: dc.link };
  } else if (dc.type === 'rich_content' && dc.content) {
    return { type: 'rich_content', content: dc.content };
  } else if (dc.type === 'json_block' && dc.json_block) {
    try {
      const parsed = JSON.parse(dc.json_block as string);
      return { type: 'json_block', ...parsed };
    } catch {
      return { type: 'json_block', code: dc.json_block };
    }
  } else if (dc.type === 'text') {
    return { type: 'text', text: dc.text };
  } else if (dc.json_block) {
    try {
      return { type: 'json_block', ...JSON.parse(dc.json_block as string) };
    } catch {
      return { type: 'json_block', code: dc.json_block };
    }
  } else if (dc.rich_content) {
    return { type: 'rich_content', content: dc.rich_content };
  } else if (dc.link) {
    return { type: 'rich_link', link: dc.link };
  } else if (dc.text) {
    return { type: 'text', text: dc.text };
  } else if (Array.isArray(displayContent)) {
    return displayContent;
  }

  return null;
}

// Build steps array from content blocks for timeline display
export function buildSteps(contentBlocks: Map<number, ContentBlock>): Step[] {
  const steps: Step[] = [];
  let pendingToolUse: Step | null = null;

  const sortedBlocks = Array.from(contentBlocks.entries())
    .sort((a, b) => a[0] - b[0]);

  for (const [idx, block] of sortedBlocks) {
    if (block.type === 'thinking' && (block.thinking || block.thinkingText || block.summaries?.length)) {
      const firstSummary = block.summaries?.[0];
      const summaryText = typeof firstSummary === 'object' ? firstSummary?.summary : firstSummary;
      steps.push({
        type: 'thinking',
        index: idx,
        thinkingText: block.thinking || block.thinkingText,
        thinkingSummary: summaryText || block.thinkingSummary,
        summaries: block.summaries,
        cut_off: block.cut_off,
        start_timestamp: block.start_timestamp,
        stop_timestamp: block.stop_timestamp
      });
    } else if (block.type === 'tool_use' && (block.name || block.toolName)) {
      pendingToolUse = {
        type: 'tool',
        index: idx,
        toolName: block.name || block.toolName,
        toolInput: block.buffered_input || block.partial_json || block.toolInput,
        toolMessage: block.toolMessage
      };
    } else if (block.type === 'tool_result' && pendingToolUse) {
      pendingToolUse.toolResult = block.toolResult || block.content;
      pendingToolUse.isError = block.is_error || block.isError;
      steps.push(pendingToolUse);
      pendingToolUse = null;
    } else if (block.type === 'text' && block.text) {
      steps.push({
        type: 'text',
        index: idx,
        text: block.text,
        citations: block.citations,
        flags: block.flags
      });
    }
  }

  if (pendingToolUse) {
    steps.push(pendingToolUse);
  }

  return steps;
}

// Process a single SSE chunk
export function processSSEChunk(
  chunk: string,
  state: StreamState,
  callbacks: StreamCallbacks
): void {
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;

    try {
      const data = JSON.parse(line.slice(6));
      processSSEEvent(data, state, callbacks);
    } catch {
      // Not valid JSON, skip
    }
  }
}

// Process a single SSE event
function processSSEEvent(
  data: Record<string, unknown>,
  state: StreamState,
  callbacks: StreamCallbacks
): void {
  const { contentBlocks, pendingCitations } = state;

  // message_start
  if (data.type === 'message_start') {
    const message = data.message as { uuid?: string } | undefined;
    if (message?.uuid) {
      state.lastMessageUuid = message.uuid;
      callbacks.onMessageStart?.(message.uuid);
    }
  }

  // content_block_start
  if (data.type === 'content_block_start') {
    const blockIndex = data.index as number;
    const contentBlock = data.content_block as Record<string, unknown> | undefined;
    const blockType = (contentBlock?.type as string) || 'text';

    const block: ContentBlock = {
      type: blockType as ContentBlock['type'],
      index: blockIndex
    };

    if (blockType === 'thinking') {
      block.thinking = '';
      block.summaries = [];
      block.start_timestamp = new Date().toISOString();
      block.thinkingText = '';
      callbacks.onThinkingStart?.(blockIndex);
    } else if (blockType === 'tool_use') {
      block.name = (contentBlock?.name as string) || 'unknown';
      block.partial_json = '';
      block.approval_key = contentBlock?.approval_key as string | undefined;
      block.toolName = block.name;
      block.toolInput = '';
      block.toolMessage = (contentBlock?.message as string) || '';
      callbacks.onToolStart?.(block.name, block.toolMessage, blockIndex);
    } else if (blockType === 'tool_result') {
      block.tool_use_id = contentBlock?.tool_use_id as string | undefined;
      block.is_error = (contentBlock?.is_error as boolean) || false;
      block.content = null;
      block.toolName = (contentBlock?.name as string) || '';
      block.isError = block.is_error;
      block.toolResult = parseDisplayContent(contentBlock?.display_content);

      if (block.toolResult) {
        callbacks.onToolResult?.(block.toolName || '', block.toolResult, block.is_error || false, blockIndex);
      }
    } else if (blockType === 'text') {
      block.text = '';
      block.citations = [];
      block.flags = [];
    }

    contentBlocks.set(blockIndex, block);
  }

  // content_block_stop
  if (data.type === 'content_block_stop') {
    const blockIndex = data.index as number;
    const block = contentBlocks.get(blockIndex);

    if (block?.type === 'thinking') {
      block.stop_timestamp = (data.stop_timestamp as string) || new Date().toISOString();
      callbacks.onThinkingStop?.(
        block.thinking || block.thinkingText || '',
        block.summaries || [],
        blockIndex
      );
    } else if (block?.type === 'tool_use') {
      block.buffered_input = (data.buffered_input as string) || block.partial_json || '{}';
      callbacks.onToolStop?.(
        block.name || block.toolName || '',
        block.buffered_input || block.toolInput || '',
        blockIndex
      );
    }
  }

  // content_block_delta
  if (data.type === 'content_block_delta') {
    const blockIndex = data.index as number;
    const block = contentBlocks.get(blockIndex);
    const delta = data.delta as Record<string, unknown> | undefined;
    const deltaType = delta?.type as string;

    if (!block) return;

    // flag_delta
    if (deltaType === 'flag_delta' && delta?.flag) {
      block.flags = block.flags || [];
      const flag = delta.flag as string;
      if (!block.flags.includes(flag)) {
        block.flags.push(flag);
      }
    }

    // Text block deltas
    if (block.type === 'text') {
      if (deltaType === 'text_delta' && delta?.text) {
        const text = delta.text as string;
        block.text = (block.text || '') + text;
        state.fullResponse += text;
        callbacks.onTextDelta?.(text, state.fullResponse, blockIndex);
      } else if (deltaType === 'citation_start_delta' && delta?.citation) {
        const citation = delta.citation as Record<string, unknown>;
        pendingCitations.set(citation.uuid as string, {
          uuid: citation.uuid as string,
          start_index: (block.text || '').length,
          url: citation.url as string | undefined,
          title: citation.title as string | undefined,
          source_type: citation.source_type as string | undefined
        });
      } else if (deltaType === 'citation_end_delta' && delta?.citation_uuid) {
        const citationUuid = delta.citation_uuid as string;
        const pendingCitation = pendingCitations.get(citationUuid);
        if (pendingCitation) {
          pendingCitation.end_index = (block.text || '').length;
          block.citations = block.citations || [];
          block.citations.push(pendingCitation);
          pendingCitations.delete(citationUuid);
          callbacks.onCitation?.(pendingCitation, blockIndex);
        }
      }
    }

    // Thinking block deltas
    if (block.type === 'thinking') {
      if (deltaType === 'thinking_delta' && delta?.thinking) {
        const thinking = delta.thinking as string;
        block.thinking = (block.thinking || '') + thinking;
        block.thinkingText = block.thinking;
        callbacks.onThinkingDelta?.(block.thinking, blockIndex);
      } else if (deltaType === 'thinking_summary_delta' && delta?.summary) {
        block.summaries = block.summaries || [];
        block.summaries.push(delta.summary as { summary: string } | string);
        const summary = delta.summary as { summary?: string } | string;
        block.thinkingSummary = typeof summary === 'object' ? summary.summary : summary;
      } else if (deltaType === 'thinking_cut_off_delta') {
        block.cut_off = (delta?.cut_off as boolean) ?? true;
      }
    }

    // Tool use block deltas
    if (block.type === 'tool_use') {
      if (deltaType === 'input_json_delta' && delta?.partial_json) {
        block.partial_json = (block.partial_json || '') + (delta.partial_json as string);
        block.toolInput = block.partial_json;
      }
    }

    // Tool result block deltas
    if (block.type === 'tool_result') {
      if (deltaType === 'input_json_delta' && delta?.partial_json) {
        const rawJson = (block.partial_json || '') + (delta.partial_json as string);
        block.partial_json = rawJson;
        try {
          const parsed = JSON.parse(rawJson);
          if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((d: unknown) => typeof d === 'object' && d !== null && 'type' in d)) {
            block.content = parsed;
          } else {
            block.content = [{ type: 'text', text: rawJson }];
          }
          if (Array.isArray(parsed)) {
            block.toolResult = parsed;
          } else if (parsed.rich_content) {
            block.toolResult = { rich_content: parsed.rich_content };
          } else if (parsed.link) {
            block.toolResult = { link: parsed.link };
          } else {
            block.toolResult = { json_block: parsed };
          }
          callbacks.onToolResult?.(block.toolName || '', block.toolResult, block.is_error || false, blockIndex);
        } catch {
          block.content = [{ type: 'text', text: rawJson }];
        }
      }
    }
  }

  // tool_use_block_update_delta
  if (data.type === 'tool_use_block_update_delta') {
    const blockIndex = data.index as number;
    const block = contentBlocks.get(blockIndex);
    if (block && data.message) {
      block.toolMessage = data.message as string;
      callbacks.onToolStart?.(block.name || block.toolName || '', block.toolMessage, blockIndex);
    }
  }

  // thinking_summary_delta at event level
  if (data.type === 'thinking_summary_delta') {
    const blockIndex = data.index as number;
    const block = contentBlocks.get(blockIndex);
    if (block && data.summary) {
      block.summaries = block.summaries || [];
      block.summaries.push(data.summary as { summary: string } | string);
    }
  }

  // tool_approval
  if (data.type === 'tool_approval') {
    callbacks.onToolApproval?.(
      data.tool_name as string,
      data.approval_key as string,
      data.input
    );
  }

  // compaction_status
  if (data.type === 'compaction_status') {
    callbacks.onCompaction?.(data.status as string, data.message as string | undefined);
  }

  // message_delta with stop_reason - message complete
  const messageDelta = data.delta as { stop_reason?: string } | undefined;
  if (data.type === 'message_delta' && messageDelta?.stop_reason) {
    const steps = buildSteps(contentBlocks);
    pendingCitations.clear();
    callbacks.onComplete?.(state.fullResponse, steps, state.lastMessageUuid);
  }
}
