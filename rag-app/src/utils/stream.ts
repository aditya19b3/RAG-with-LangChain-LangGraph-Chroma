/**
 * Streams tokens from the graph's generate node to the client.
 * Serves as a helper for Server-Sent Events (SSE) or WebSockets.
 */
export async function* streamAnswer(
  compiledGraph: any,
  inputs: Record<string, any>,
  config: any = {}
): AsyncGenerator<string, void, unknown> {
  const stream = await compiledGraph.stream(
    inputs,
    { ...config, streamMode: 'messages' }
  );

  for await (const [chunk, metadata] of stream) {
    // Only yield tokens produced by the 'generate' node to keep evaluation,
    // query transformations, and grading steps silent to the end user.
    if (metadata?.langgraph_node === 'generate' && chunk?.content) {
      yield String(chunk.content);
    }
  }
}

