// The sizing spike's components. Blurb: a label with no size of its own,
// sized by its text (Dynamic Type on iOS, sp on Android: it follows the
// font scale), whose `append` command changes the text natively (no React
// commit), and `appendLater` 200 ms later from a native timer (no command
// either). Picture: an image view, empty until `load` sets an image after
// an await, as a platform's image loader would; `announce` has it call
// invalidateSize() once the image is in. Internal, like the views spike
// (scripts/views-spike.ts --entry sizing.js).
import type { ImageView, TextView } from "lucent:android/android.widget";
import type { UIImageView, UILabel } from "lucent:ios/UIKit";

export declare function Blurb(props: { text: string }): UILabel | TextView;

export declare function Picture(props: { name: string }): UIImageView | ImageView;
