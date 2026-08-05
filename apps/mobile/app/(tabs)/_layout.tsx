import { Tabs, useRouter } from 'expo-router';
import { Home, Plus, Settings, ShoppingBasket, Sprout } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '../../src/constants/theme';

export default function TabLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // ジェスチャーナビゲーションのバーがタブのラベルに被るため下端を空ける
        tabBarStyle: [styles.tabBar, { height: 58 + insets.bottom, paddingBottom: insets.bottom }],
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.inkDim,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'ホーム',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="plantings"
        options={{
          title: '栽培',
          tabBarIcon: ({ color, size }) => <Sprout size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: '追加',
          tabBarIcon: ({ color, size }) => (
            <View style={[styles.addButton, { borderColor: color }]}>
              <Plus size={size * 0.8} color={color} />
            </View>
          ),
        }}
        // ＋ は画面ではなく「栽培を追加」への近道にする。だいどこの add.tsx は
        // レシピの作成方法シートで、さいえん手帳には該当する分岐がないため。
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            router.push('/plantings/new');
          },
        }}
      />
      {/* 収穫は 3 本柱のひとつ。栽培の中に畳むと「今日の採れたてを撮る」導線が
          2 階層深くなり、R06 の最短 3 タップを満たせない（docs/画面設計.md §3） */}
      <Tabs.Screen
        name="harvests"
        options={{
          title: '収穫',
          tabBarIcon: ({ color, size }) => <ShoppingBasket size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '設定',
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
      {/* Non-tab screens within the (tabs) group — hidden from tab bar */}
      {/* recipes 系は WBS 1.5 でタブから外した。画面自体は削除まで残す */}
      <Tabs.Screen name="recipes" options={{ href: null }} />
      <Tabs.Screen name="places" options={{ href: null }} />
      <Tabs.Screen name="backup" options={{ href: null }} />
      <Tabs.Screen name="licenses" options={{ href: null }} />
      <Tabs.Screen name="ai-key" options={{ href: null }} />
      <Tabs.Screen name="shopping" options={{ href: null }} />
      <Tabs.Screen name="pantry" options={{ href: null }} />
      <Tabs.Screen name="scan-barcode" options={{ href: null }} />
      <Tabs.Screen name="receipt" options={{ href: null }} />
      <Tabs.Screen name="recipes/import-photo" options={{ href: null }} />
      <Tabs.Screen name="recipes/import-ocr" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.bg,
    borderTopColor: Colors.line,
    borderTopWidth: 1,
    height: 58,
    paddingTop: 4,
  },
  tabLabel: {
    fontSize: 9,
    letterSpacing: 0.5,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accentSoft,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -10,
  },
});
