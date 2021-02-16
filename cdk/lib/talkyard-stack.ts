import {
  GuParameter,
  GuStack,
  GuStackProps,
  GuSubnetListParameter,
} from "@guardian/cdk/lib/constructs/core";
import { App } from "@aws-cdk/core";
import { GuSecurityGroup, GuVpc } from "@guardian/cdk/lib/constructs/ec2";
import { GuInstanceRole } from "@guardian/cdk/lib/constructs/iam";
import { transformToCidrIngress } from "@guardian/cdk/lib/utils";
import {
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  MachineImage,
  Subnet,
  UserData,
} from "@aws-cdk/aws-ec2";
import { GuardianNetworks } from "@guardian/private-infrastructure-config";

export class TalkyardStack extends GuStack {
  constructor(scope: App, id: string, props: GuStackProps) {
    super(scope, id, props);
    const uid = (resource: string): string => `${this.app}-${resource}`;

    const parameters = {
      subnets: new GuSubnetListParameter(this, uid("subnets-param"), {
        description: "The subnets where Talkyard instances will run",
      }),
      subnet: new GuParameter(this, uid("subnet-param"), {
        type: "<AWS::EC2::Subnet::Id>",
        description: "The subnet where Talkyard instances will run",
      }),
    };

    const vpc = GuVpc.fromIdParameter(this, "vpc");
    const subnet = Subnet.fromSubnetAttributes(this, uid("subnet"), {
      subnetId: parameters.subnet.valueAsString,
      availabilityZone: this.availabilityZones[0],
    });
    // const subnets = GuVpc.subnets(this, parameters.subnets.valueAsList);
    // const serverPort = 80; // TODO: Establish correct port for server

    const talkyardRole = new GuInstanceRole(this, uid("instance-role"), {
      withoutLogShipping: true,
    });

    const appSecurityGroup = new GuSecurityGroup(
      this,
      uid("app-security-group"),
      {
        description: "HTTP",
        vpc,
        allowAllOutbound: true,
        overrideId: true,
        ingresses: transformToCidrIngress(Object.entries(GuardianNetworks)),
      }
    );

    // TODO: Fill this in correctly from: https://github.com/debiki/talkyard-prod-one
    const userData = UserData.custom(`#!/bin/bash -ev
    
apt-get update
apt-get -y install git vim locales
locale-gen en_US.UTF-8                      # installs English
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8  # starts using English (warnings are harmless)
cd /opt/
git clone https://github.com/debiki/talkyard-prod-one.git talkyard
cd talkyard
./scripts/prepare-ubuntu.sh 2>&1 | tee -a talkyard-maint.log
./scripts/install-docker-compose.sh 2>&1 | tee -a talkyard-maint.log
./scripts/start-firewall.sh 2>&1 | tee -a talkyard-maint.log

aws s3 cp s3://deploy-tools-dist/${this.stack}/${this.stage}/${this.app}/play-framework.conf /opt/talkyard/conf/play-framework.conf
aws s3 cp s3://deploy-tools-dist/${this.stack}/${this.stage}/${this.app}/.env                /opt/talkyard/.env
              
cp mem/2g.yml docker-compose.override.yml
./scripts/upgrade-if-needed.sh 2>&1 | tee -a talkyard-maint.log
./scripts/schedule-logrotate.sh 2>&1 | tee -a talkyard-maint.log
./scripts/schedule-daily-backups.sh 2>&1 | tee -a talkyard-maint.log
./scripts/schedule-automatic-upgrades.sh 2>&1 | tee -a talkyard-maint.log

`);

    new Instance(this, uid("instance"), {
      vpc,
      userData,
      instanceType: InstanceType.of(InstanceClass.M3, InstanceSize.MEDIUM),
      machineImage: MachineImage.latestAmazonLinux(), // TODO: Work this out
      securityGroup: appSecurityGroup,
      role: talkyardRole,
      vpcSubnets: {
        subnets: [subnet],
        // availabilityZones: this.availabilityZones,
      },
    });
  }
}
