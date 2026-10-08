import { detailsPlugin } from '@voithos-labs/aragonite/plugins/details';
import { footnotesPlugin } from '@voithos-labs/aragonite/plugins/footnotes';
import { slashCommandsPlugin } from '@voithos-labs/aragonite/plugins/slash-commands';

// Aragonite installs plugins once per process, first set wins, so every editor shares this array.
export const plugins = [slashCommandsPlugin(), footnotesPlugin(), detailsPlugin()];
