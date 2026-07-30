function publicFailureCode(error) {
  const message = String(error?.message || error || 'SYNTHETIC_REMOTE_SMOKE_FAILED');
  const match = message.match(/(?:^|[^A-Z0-9_])([A-Z][A-Z0-9_]{2,99})(?=[:\s]|$)/);
  return match?.[1] || 'SYNTHETIC_REMOTE_SMOKE_FAILED';
}

try {
  const invocation = encodeURIComponent(String(process.env.GITHUB_RUN_ATTEMPT || Date.now()));
  await import(`./run-staging-commercial-config-remote-smoke.mjs?invocation=${invocation}`);
  await import(`./run-staging-synthetic-remote-smoke.mjs?invocation=${invocation}`);
} catch (error) {
  console.error(publicFailureCode(error));
  process.exitCode = 1;
}
