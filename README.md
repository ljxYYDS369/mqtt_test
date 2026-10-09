# mqtt_test

一个**纯静态**的 MQTT 遥测看板：设备（4G 模组 / ESP32-P4）通过 MQTT 持续上报数据，网页用 `mqtt.js` over **WSS** 订阅，实时展示并**缓存在浏览器本地（IndexedDB）**。无需任何后端服务器。

演示地址（开启 GitHub Pages 后）：`https://ljxYYDS369.github.io/mqtt_test/`

## 架构

```
4G模块(ML307R) --MQTT--> 公网 broker <--mqtt.js over WSS-- 浏览器(存 IndexedDB)
                         (broker = 会合点, 免公网IP)
GitHub Pages: 只托管 index.html
```

- broker 是唯一的"公网会合点"：模块和电脑都只需**主动往外连**，谁都不需要公网 IP。
- 网页是 HTTPS，必须连 **`wss://`**（`ws://` 会被浏览器按混合内容拦截）。

## 功能

- 支持 broker / topic 配置，下拉切换公共 broker（EMQX / HiveMQ）或自定义
- 实时状态：本次接收数、缓存条数、速率(msg/s)、累计字节、最后一条时间
- 速率曲线（canvas 迷你图）
- 最近 300 条消息表格（时间 / 来源 / topic / 字节 / payload）
- 所有消息批量写入 **IndexedDB**，支持**导出 JSON / CSV**、一键**清空缓存**
- **本地模拟数据**开关：无需设备/broker 即可看效果（每 0.5s 生成一条）
- URL 参数可带配置：`?broker=wss://...&topic=xxx`

## 用法

1. 打开网页（本地双击 `index.html` 也可，或 GitHub Pages 地址）
2. 选 broker、填 topic，点**连接**
3. 想看效果：勾选**本地模拟数据**，或点**发一条测试**（会真发到 broker，其他浏览器可见）

把配置写进 URL 分享给他人：

```
https://ljxYYDS369.github.io/mqtt_test/?broker=wss://broker.emqx.io:8084/mqtt&topic=p4max/ljx369/telemetry
```

## 模组侧（中移 ML307R）MQTT AT 序列

> 已按中移 ML307R 官方 AT 手册核对。`\r\n` 结尾，串口 115200。域名首次需 DNS 解析，约等 10s。

```
AT
ATE0
AT+CPIN?
AT+CEREG?
AT+MQTTDISC=0                                   // 先断开 0 号，忽略返回
AT+MQTTCONN=0,"broker.emqx.io",1883,"p4max-001","",""
        // OK
        // +MQTTURC: "conn",0,0                    // 连接成功 URC
```

发布（先发命令进数据模式，等 `>` 再发数据）：

```
AT+MQTTPUB=0,"p4max/ljx369/telemetry",0,0,0,72
        // >
{"seq":1,"uptime":12,"ws63_tx":47040,"rid_frames":360,"t":25.3}
        // +MQTTPUB: 0,xxx,50
        // OK
```

也可把内容直接内联：

```
AT+MQTTPUB=0,"p4max/ljx369/telemetry",0,0,0,<len>,"{...json...}"
```

参数说明：`AT+MQTTPUB=<id>,<topic>,<qos>,<retain>,<dup>,<msg_len>`。

### 高功耗 / 高吞吐建议

- 用 **QoS 0**（不等 PUBACK），大 payload、高频发布 → 射频 TX 占空比拉满
- 关闭模组省电：禁用 PSM / eDRX，keepalive 取最短，连接不断开
- broker 端突发积压时，注意公共 broker 有限速

## 部署到 GitHub Pages

仓库 `Settings → Pages → Build and deployment → Source: Deploy from a branch`，选 `main` 分支 `/ (root)`，保存。稍等片刻即可访问上述 URL。

## 注意

- 公共 broker（`broker.emqx.io` / `broker.hivemq.com`）是公开测试用的，**不要发敏感数据**，且会限速/不稳；正式场景建议自建 EMQX/Mosquitto。
- 页面**必须开着**才会接收并缓存；`IndexedDB` 刷新后仍在（同一浏览器），但清缓存/换设备即丢失——仅适合演示/缓存，不是可靠存储。

## 文件

- `index.html` — 全部前端（订阅 + 缓存 + 看板），单文件开箱即用
- `README.md` — 本文件
