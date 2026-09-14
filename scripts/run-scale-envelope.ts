import { runScaleEnvelopeCampaign } from "../packages/competition-engine/src/scale-envelope-campaign.js";

process.stdout.write(`${JSON.stringify(runScaleEnvelopeCampaign(), null, 2)}\n`);
