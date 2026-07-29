function publicFailureCode(error) {
  const message = String(error?.message || error || 'SYNTHETIC_REMOTE_SMOKE_FAILED');
  const match = message.match(/(?:^|[^A-Z0-9_])([A-Z][A-Z0-9_]{2,99})(?=[:\s]|$)/);
  return match?.[1] || 'SYNTHETIC_REMOTE_SMOKE_FAILED';
}

try {
  await import(`./run-staging-synthetic-remote-smoke.mjs?invocation=${encodeURIComponent(
    String(process.env.GITHUB_RUN_ATTEMPT || Date.now())
  )}`);
} catch (error) {
  console.error(publicFailureCode(error));
  process.exitCode = 1;
}
