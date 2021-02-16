import {
  GuArnParameter,
  GuStack,
  GuStackProps,
} from "@guardian/cdk/lib/constructs/core";
import { App, Duration } from "@aws-cdk/core";
import { GuSecurityGroup, GuVpc } from "@guardian/cdk/lib/constructs/ec2";
import { GuInstanceRole } from "@guardian/cdk/lib/constructs/iam";
import { GuApplicationTargetGroup } from "@guardian/cdk/lib/constructs/loadbalancing";
import {
  ApplicationProtocol,
  TargetType,
} from "@aws-cdk/aws-elasticloadbalancingv2";
import { transformToCidrIngress } from "@guardian/cdk/lib/utils";
import {
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  Peer,
  Port,
  UserData,
} from "@aws-cdk/aws-ec2";
import { GuardianNetworks } from "@guardian/private-infrastructure-config";

const uid = (resource: string): string => `talkyard-${resource}`;

export class TalkyardStack extends GuStack {
  constructor(scope: App, id: string, props: GuStackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    const secrets = {};
    const parameters = {
      TLSCert: new GuArnParameter(this, uid("TLSCert"), {
        description: "ARN of a TLS certificate to install on the load balancer",
      }),
    };
    const serverPort = 3000; // TODO: Establish correct port for server

    const vpc = GuVpc.fromIdParameter(this, "vpc");
    const subnets = GuVpc.subnetsfromParameter(this);

    const talkyardRole = new GuInstanceRole(this, uid("instance-role"), {
      withoutLogShipping: true,
    });

    // TODO: Identify what the health check will be for this
    const targetGroup = new GuApplicationTargetGroup(
      this,
      "TalkyardInternalTargetGroup",
      {
        vpc: vpc,
        port: serverPort,
        protocol: ApplicationProtocol.HTTP,
        targetType: TargetType.INSTANCE,
        healthCheck: {
          port: serverPort.toString(),
          path: "/api/health",
          interval: Duration.minutes(1),
          timeout: Duration.seconds(3),
        },
        deregistrationDelay: Duration.seconds(30),
        overrideId: true,
      }
    );

    // TODO: Does the egress rule need to be anyIpv4?
    const loadBalancerSecurityGroup = new GuSecurityGroup(
      this,
      uid("lb-security-group"),
      {
        description:
          "Guardian IP range has access to the load balancer on port 80",
        vpc: vpc,
        allowAllOutbound: false,
        overrideId: true,
        ingresses: transformToCidrIngress(Object.entries(GuardianNetworks)),
        egresses: [{ range: Peer.anyIpv4(), port: Port.tcp(serverPort) }],
      }
    );

    const appSecurityGroup = new GuSecurityGroup(
      this,
      uid("app-security-group"),
      { description: "HTTP", vpc, allowAllOutbound: false, overrideId: true }
    );

    // TODO: Fill this in correctly from: https://github.com/debiki/talkyard-prod-one
    const userData = UserData.custom(`#!/bin/bash -ev

          aws s3 cp s3://deploy-tools-dist/deploy/${this.stage}/talkyard/talkyard.zip /tmp/talkyard.zip
          cd /
          unzip -o /tmp/talkyard.zip

`);

    const ec2Instance = new Instance(this, uid("instance"), {
      vpc,
      userData,
      instanceType: InstanceType.of(InstanceClass.M3, InstanceSize.MEDIUM),
      machineImage: MachineImage.lookup({ name: "sortThis" }), // TODO: Work this out
      securityGroup: appSecurityGroup,
    });
  }
}
