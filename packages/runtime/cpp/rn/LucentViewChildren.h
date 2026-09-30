// Lucent runtime — the React children of a Lucent component on iOS, and
// the view they are mounted in: its slot (lucent:ui's `slot`).
//
// Who owns what:
//
// - React Native owns each child: it creates, updates, lays out (the
//   child's frame, in the component's coordinates, as Yoga computed it)
//   and destroys it, and says where it goes (mount or unmount at an index
//   of the component's children).
// - The host (LucentComponentView, through LucentChildren) owns the slot
//   and the children's place in it: it makes a slot for each mount, puts
//   every child React Native mounts in it in React Native's order, takes
//   out the ones React Native unmounts, and does nothing else to them.
// - The setup owns the slot's place: its ancestors, its z-order among its
//   siblings, and its frame (it fills the view it is added to unless the
//   setup sizes it).
//
// The slot shows its children in the component's coordinates wherever it
// is: its bounds' origin is its own origin in the host, so a child shows
// at the frame Yoga gave it. It realigns when it moves or resizes, when the
// host lays out, and after each commit and command the mount applies (UIKit
// tells a view nothing when an ancestor moves without resizing it), and
// then tells the host it was placed: the host reports where it is, so that
// Yoga lays the children out in its rectangle (LucentViewSlots.h). It
// clips its children to its bounds, so a child shows, and receives
// touches, where it falls inside the slot. It never lays them out.
#pragma once

#import <UIKit/UIKit.h>

/** A component's slot. Main thread. */
@interface LucentSlotView : UIView

/// A slot for the React children of a component shown by `host`, which
/// calls `placed` each time it has laid itself out.
- (instancetype)initWithHost:(UIView *)host placed:(void (^)(void))placed;

/// Shows its children where Yoga put them, as its place in the host is now.
- (void)lucentAlign;

@end

/**
 * One host view's React children, in React Native's order, and the slot
 * of its current mount. Main thread.
 */
@interface LucentChildren : NSObject

/// The children of `host`, a view of the component registered as `name`,
/// which takes React children if `takesChildren`; each slot calls `placed`
/// after it lays itself out.
- (instancetype)initWithHost:(UIView *)host
                        name:(NSString *)name
               takesChildren:(BOOL)takesChildren
                      placed:(void (^)(void))placed;

/// The current mount's slot, or nil (no mount, or no children taken).
@property (nonatomic, readonly) LucentSlotView *slot;

/// React Native mounts `child` at `index` of the component's children.
- (void)mount:(UIView *)child index:(NSInteger)index;

/// React Native unmounts `child`, at `index` of the component's children.
- (void)unmount:(UIView *)child index:(NSInteger)index;

/// A mount starts: a new slot holding every child, if the component takes them.
- (void)startMount;

/// The mount's setup returned `content` (nil if it failed): its slot should be in it.
- (void)mountedContent:(UIView *)content;

/// The mount's code ran (a commit, a command): its native views may have
/// moved the slot, which UIKit does not tell it; it realigns at the next
/// layout.
- (void)contentChanged;

/// The mount ends (the view is recycled): its slot goes.
- (void)endMount;

@end
