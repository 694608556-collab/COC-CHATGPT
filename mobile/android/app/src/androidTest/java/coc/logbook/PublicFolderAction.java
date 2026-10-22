package coc.logbook;

/** DocumentsUI controls, used only after the current public fixture folder is visible. */
final class PublicFolderAction {
    static boolean matches(String id, String text) {
        return (id != null && id.endsWith(":id/action_menu_select")) ||
            "选择".equals(text) || "SELECT".equals(text) || "使用此文件夹".equals(text) ||
            "USE THIS FOLDER".equals(text) || "允许".equals(text) || "ALLOW".equals(text) ||
            ("android:id/button1".equals(id) && text != null &&
             text.matches("ALLOW ACCESS TO \"COC-PUBLICIO-[A-Z0-9-]+\""));
    }
}
