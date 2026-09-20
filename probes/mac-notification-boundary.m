#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

static int probeAlarm(NSString *message, int code) {
    fprintf(stderr, "ALARM %s\n", message.UTF8String);
    return code;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return probeAlarm(@"usage: mac-notification-boundary {public|accessibility-preflight|database}", 2);
        NSBundle *bundle = [NSBundle bundleWithPath:@"/Applications/LarkSuite.app"];
        NSString *bundleID = bundle.bundleIdentifier;
        if (!bundleID) return probeAlarm(@"LarkSuite.app not found or has no bundle id", 2);
        NSString *version = [bundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"unknown";
        NSString *mode = [NSString stringWithUTF8String:argv[1]];

        if ([mode isEqualToString:@"public"]) {
            bool frameworkAvailable = NSClassFromString(@"UNUserNotificationCenter") != Nil;
            printf("framework_available=%s scope=current_app_only target_bundle=%s target_version=%s other_apps_visible=false notification_content_read=false\n",
                   frameworkAvailable ? "true" : "false", bundleID.UTF8String, version.UTF8String);
            if (!frameworkAvailable) return probeAlarm(@"UserNotifications framework unavailable", 3);
            return 0;
        }
        if ([mode isEqualToString:@"accessibility-preflight"]) {
            bool trusted = AXIsProcessTrusted();
            printf("target_bundle=%s accessibility_trusted=%s prompt_requested=false banner_observation_not_executed=true\n",
                   bundleID.UTF8String, trusted ? "true" : "false");
            return trusted ? 0 : probeAlarm(@"Accessibility permission absent; recorded only, not requested", 3);
        }
        if ([mode isEqualToString:@"database"])
            return probeAlarm(@"notification database access refused: requires elevated privacy access and contains prohibited message metadata/content", 4);
        return probeAlarm(@"unknown mode", 2);
    }
}
