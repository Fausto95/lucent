import { PLATFORM } from "lucent:platform";
import { signal } from "lucent:ui";
import { Animation, Color, Font, HStack, Image, Text } from "lucent:swiftui";
import {
  Alignment, Arrangement, Color as CColor, FontWeight, Modifier, Row,
  Spring, Text as CText, animateFloatAsState, dp, sp, spring,
} from "lucent:compose";

export function Like(props: { count: number }) {
  const liked = signal(false);
  const toggle = () => liked.set(!liked.get());
  const count = () => props.count + (liked.get() ? 1 : 0);

  if (PLATFORM === "ios") {
    return (
      <HStack spacing={6} onTapGesture={toggle}>
        <Image
          systemName={liked.get() ? "heart.fill" : "heart"}
          foregroundStyle={liked.get() ? Color.pink : Color.gray}
          scaleEffect={liked.get() ? 1.3 : 1}
          animation={[
            Animation.spring({ response: 0.3, dampingFraction: 0.4 }),
            { value: liked.get() },
          ]}
        />
        <Text font={Font.headline}>{`${count()}`}</Text>
      </HStack>
    );
  }

  const pop = animateFloatAsState(
    liked.get() ? 1.3 : 1,
    spring({ dampingRatio: Spring.DampingRatioHighBouncy }),
  );

  return (
    <Row
      horizontalArrangement={Arrangement.spacedBy(dp(8))}
      verticalAlignment={Alignment.CenterVertically}
      modifier={Modifier.clickable(toggle)}
    >
      <CText
        text={liked.get() ? "♥︎" : "♡"}
        color={liked.get() ? CColor(0xffff2d55) : CColor.Gray}
        fontSize={sp(24)}
        modifier={Modifier.scale(pop.value)}
      />
      <CText text={`${count()}`} fontSize={sp(17)} fontWeight={FontWeight.Bold} />
    </Row>
  );
}
