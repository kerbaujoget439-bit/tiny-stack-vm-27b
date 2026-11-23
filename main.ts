// Entry point for the tiny stack VM entry.
// The VM program itself is this entry's secret, delivered by make.fun as
// the environment variable V on every run; this loader just executes it.
eval(String(process.env.V ?? ''));
