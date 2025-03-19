---
title: Spring Boot集成Akka
lang: cn
catalog: true
date: 2022-10-17 21:56:29
tags:
- Akka
---
> 摘要：本文主要介绍 `Spring Boot`如何集成  `Akka`

## Actor简介

「[Actor 模型](https://en.wikipedia.org/wiki/Actor_model)」为编写并发和分布式系统提供了更高级别的抽象。它减少了开发人员必须处理显式锁和线程管理的问题，使编写正确的并发和并行系统变得更容易。1973 年卡尔·休伊特（`Carl Hewitt`）在论文中定义了 Actors，然后通过 Erlang 语言所普及，并且在爱立信（`Ericsson`）成功地建立了高度并发和可靠的电信系统。

Akka 的 Actors API 类似于 Scala Actors，它从 Erlang 中借用了一些语法。

## Maven 配置

```xml
<properties>
        <java.version>8</java.version>
        <spring.version>4.3.1.RELEASE</spring.version>
        <akka.version>2.5.21</akka.version>
        <scala-lang.version>2.12.8</scala-lang.version>
        <scala-binaries.version>2.10</scala-binaries.version>
        <scala-java8-compat_2.12.version>0.9.0</scala-java8-compat_2.12.version>
    </properties>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>junit</groupId>
            <artifactId>junit</artifactId>
            <version>4.13.1</version>
            <scope>test</scope>
        </dependency>

<!--        akka配置-->
        <dependency>
            <groupId>org.scala-lang</groupId>
            <artifactId>scala-library</artifactId>
            <version>${scala-lang.version}</version>
        </dependency>
        <dependency>
            <groupId>com.typesafe.akka</groupId>
            <artifactId>akka-actor_2.12</artifactId>
            <version>${akka.version}</version>
            <exclusions>
                <exclusion>
                    <groupId>org.scala-lang.modules</groupId>
                    <artifactId>scala-java8-compat_2.12</artifactId>
                </exclusion>
            </exclusions>
        </dependency>
        <dependency>
            <groupId>com.typesafe.akka</groupId>
            <artifactId>akka-slf4j_2.12</artifactId>
            <version>${akka.version}</version>
        </dependency>
        <dependency>
            <groupId>org.scala-lang.modules</groupId>
            <artifactId>scala-java8-compat_2.12</artifactId>
            <version>${scala-java8-compat_2.12.version}</version>
        </dependency>
        <dependency>
            <groupId>javax.inject</groupId>
            <artifactId>javax.inject</artifactId>
            <version>1</version>
        </dependency>
    </dependencies>
```

## 构造 SpringActorProducer

第一步先实现一个 `SpringActorProducer `， 通过 `ApplicationContext` 对象以 `bean` 名称的方式来创建 `Actor`


```java
public class SpringActorProducer implements IndirectActorProducer {

    /**
     * 上下文
     */
    private ApplicationContext applicationContext;

    /**
     * actor实例的名字
     */
    private String beanActorName;

    public SpringActorProducer(ApplicationContext applicationContext, String beanActorName) {
        this.applicationContext = applicationContext;
        this.beanActorName = beanActorName;
    }


    /**
     * 每次调用时生成一个新的 actor实例，不允许多次返回同一个实例
     * @return actor实例
     */
    @Override
    public Actor produce() {
        return (Actor) applicationContext.getBean(beanActorName);
    }

    /**
     * 确定创建参与者的类型
     */
    @Override
    public Class<? extends Actor> actorClass() {
        return (Class<? extends Actor>) applicationContext.getType(beanActorName);
    }
}
```

`IndirectActorProducer` 是 `actor` 的一个策略接口， 它可以让注入框架确定实际的 `actor` 类并实例化。


## 构造 SpringExt对象，创建ActorRef


通过 `SpringExt` 我们可以使用 `Props` 创建 `ActorRef` 对象

```java
/**
 * 构造props对象，创建ActorRef
 */
@Slf4j
public class SpringExt implements Extension {

    private ApplicationContext applicationContext;

    /**
     * 初始化
     * @param applicationContext 上下文
     */
    public  void init(ApplicationContext applicationContext) {
        log.info("applicationContext 初始化");
        this.applicationContext = applicationContext;
    }

    /**
     * 用创建的SpringActorProducer获取props对象，用量创建Actor
     * @return props
     */
    public Props props(String beanName){
        return Props.create(SpringActorProducer.class, this.applicationContext, beanName);
    }

}
```

`Extension` 是 `actor` 的一个拓展插件，其中 `Extension` 在每个 `ActorSystem` 中只会加载一次，然后被 `akka` 管理。可以在 `ActorSystem` 启动的时候以编程的方式加载，也可以通过配置的方式自动加载。由于 `Extension` 是在   `ActorSystem` 层面的扩展，所以需要自己处理线程安全的问题。


## 创建SpringExtProvider

通过创建 SpringExtProvider 获取 SpringExt 。

```java
public class SpringExtProvider extends AbstractExtensionId<SpringExt> {

    public static final SpringExtProvider SPRING_EXTENSION_PROVIDER = new SpringExtProvider();

    public static SpringExtProvider getInstance() {
        return SPRING_EXTENSION_PROVIDER;
    }
    @Override
    public SpringExt createExtension(ExtendedActorSystem extendedActorSystem) {
        return new SpringExt();
    }

}
```

`AbstractExtensionId` 是 `ExtensionId` 抽象类，`ExtensionId` 可以理解为 `Extension` 的一个唯一标志，`ActorSystem` 会根据它来判断 `Extension` 是否被加载过，以确保 `Extension` 只能加载一次。


## 创建 Spring 配置类

这里我们通过 `@Configuration` 创建一个配置类来初始化 `ActorSystem` 。

```java
@Configuration
public class AkkaConfig {

    private final ApplicationContext context;

    @Autowired
    public AkkaConfig(ApplicationContext context) {
        this.context = context;
    }

    @Bean
    public ActorSystem createSystem() {
        ActorSystem system = ActorSystem.create("system");
        SpringExtProvider.getInstance().get(system).init(context);
        return system;
    }
}

```

到这里我们已经完成了所有配置，接下来将介绍如何使用 `Akka` 。


## 创建一个Actor

创建一个 `actor` ，注意使用依赖注入框架时，`Actor` 不能配置为单例（这里我也不知道为什么)， 这里加上 `@Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE) 。`

```java
@Slf4j
@Component
@Scope(ConfigurableBeanFactory.SCOPE_PROTOTYPE)
public class MyActor extends AbstractActor {

    @Override
    public Receive createReceive() {
        return receiveBuilder().matchAny(msg -> {
            log.info("Received message: {}", msg);
        }).build();
    }
}
```

## 测试Actor

新建测试类，注意 `props("myActor")` 这里 `myActor` 为你刚刚新建的 `actor` （这里注意大小写)， 第二个是你定义的 `Actor` 名字。

```java

@RunWith(SpringRunner.class)
@SpringBootTest
public class AkkaTest {

    @Resource
    private ActorSystem actorSystem;

    @Test
    public void sendMsg() {
        ActorRef testActor = actorSystem.actorOf(SpringExtProvider.getInstance().get(actorSystem).props("myActor"), "myActor");
        testActor.tell("hello",ActorRef.noSender());
    }

}
```

启动测试类，日志如下

```
2022-10-18 22:23:53.976  INFO 66863 --- [           main] com.risk.risk.akka.AkkaTest              : Started AkkaTest in 1.815 seconds (JVM running for 2.182)
2022-10-18 22:23:54.127  INFO 66863 --- [lt-dispatcher-3] com.risk.risk.akka.MyActor               : Received message: hello
```
