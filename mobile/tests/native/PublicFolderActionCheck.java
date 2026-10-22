package coc.logbook;

/** Captured AOSP labels contain only this test's fictional directory. */
public final class PublicFolderActionCheck {
    private static void check(boolean value, String label) {
        if (!value) throw new AssertionError(label);
    }
    public static void main(String[] args) {
        check(PublicFolderAction.matches("android:id/button1",
            "ALLOW ACCESS TO \"COC-PUBLICIO-PUBLIC-0123-4567\""), "AOSP folder authorization button");
        check(PublicFolderAction.matches("com.android.documentsui:id/action_menu_select", ""), "AOSP menu action");
        check(PublicFolderAction.matches(null, "使用此文件夹"), "Chinese folder action");
        check(PublicFolderAction.matches(null, "ALLOW"), "English confirmation");
        check(!PublicFolderAction.matches("android:id/button1", "ALLOW ACCESS TO \"PERSONAL\""), "Do not authorize unrelated directory");
        check(!PublicFolderAction.matches("android:id/button2", "CANCEL"), "Do not cancel");
        check(!PublicFolderAction.matches(null, null), "Ignore non-controls");
        System.out.println("PublicFolderAction: 7 checks passed; final exact URI still required by device test");
    }
}
