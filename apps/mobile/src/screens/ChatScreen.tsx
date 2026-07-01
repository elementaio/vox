import { FlatList, StyleSheet, View } from "react-native";
import type { StoredContact, StoredMessage } from "@pochta-chat/sdk";
import MessageBubble from "../components/MessageBubble";
import Composer from "../components/Composer";
import TopBar from "../components/TopBar";
import { Link, Screen } from "../ui";
import { useI18n } from "../i18n";

export default function ChatScreen({
  contact,
  messages,
  status,
  onBack,
  onSend,
}: {
  contact: StoredContact | undefined;
  messages: StoredMessage[];
  status: string;
  onBack: () => void;
  onSend: (text: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Screen>
      <View style={s.header}>
        <TopBar
          title={contact?.name ?? "chat"}
          status={status}
          left={<Link title={`‹ ${t("back")}`} onPress={onBack} />}
        />
      </View>
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={s.list}
        renderItem={({ item }) => <MessageBubble msg={item} />}
      />
      <Composer onSend={onSend} />
    </Screen>
  );
}

const s = StyleSheet.create({
  header: { paddingTop: 48 },
  list: { padding: 12, gap: 6 },
});
